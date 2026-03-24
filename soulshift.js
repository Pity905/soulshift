Hooks.once("init", () => {
  console.log("SoulShift | Initialised");
});

// ─────────────────────────────────────────────
// CONFIGURATION
// Set the master actor name prefix and list
// of personality actor names here.
// ─────────────────────────────────────────────
const MASTER_PREFIX = "M.";
const PERSONALITY_NAMES = [
  "Torvi Yarrow",
  "Ingvar Yewdale"
  // Add more personalities here as needed
];

// ─────────────────────────────────────────────
// HELPER — flash effect on a token
// ─────────────────────────────────────────────
async function flashEffect(token) {
  const flash = new PIXI.Graphics();
  flash.beginFill(0xffffff, 0.9);
  flash.drawRect(
    token.x,
    token.y,
    token.document.width * canvas.grid.size,
    token.document.height * canvas.grid.size
  );
  flash.endFill();
  canvas.app.stage.addChild(flash);

  await new Promise(resolve => {
    let alpha = 0.9;
    const fade = setInterval(() => {
      alpha -= 0.09;
      flash.alpha = Math.max(alpha, 0);
      if (alpha <= 0) {
        clearInterval(fade);
        canvas.app.stage.removeChild(flash);
        flash.destroy();
        resolve();
      }
    }, 30);
  });
}

// ─────────────────────────────────────────────
// HELPER — get inventory items from actor
// (weapons, equipment, consumables, loot, tools)
// ─────────────────────────────────────────────
function getInventoryItems(actor) {
  const inventoryTypes = ["weapon", "equipment", "consumable", "loot", "tool", "container"];
  return actor.items.filter(i => inventoryTypes.includes(i.type));
}

// ─────────────────────────────────────────────
// HELPER — get non-inventory items from actor
// (spells, features, feats, classes, subclasses, backgrounds, races)
// ─────────────────────────────────────────────
function getNonInventoryItems(actor) {
  const inventoryTypes = ["weapon", "equipment", "consumable", "loot", "tool", "container"];
  return actor.items.filter(i => !inventoryTypes.includes(i.type));
}

// ─────────────────────────────────────────────
// CORE — perform the personality shift
// ─────────────────────────────────────────────
async function shiftPersonality(masterActor, personalityActor) {
  const token = canvas.tokens.placeables.find(t => t.actor?.id === masterActor.id);
  if (!token) {
    return ui.notifications.error("SoulShift | Master actor token not found on this scene.");
  }

  // ── 1. Collect what we want to keep from master ──
  const currentHP = masterActor.system.attributes.hp.value;
  const currentTempHP = masterActor.system.attributes.hp.temp ?? 0;
  const inventoryItems = getInventoryItems(masterActor).map(i => i.toObject());
  const currency = foundry.utils.deepClone(masterActor.system.currency);
  const effects = masterActor.effects
    .filter(e => !e.isTemporary)
    .map(e => e.toObject());

  // ── 2. Build stat update from personality ──
  const p = personalityActor.system;
  const newMaxHP = p.attributes.hp.max;

  // Handle HP overflow → temp HP
  let newHP = currentHP;
  let newTempHP = currentTempHP;
  if (currentHP > newMaxHP) {
    newTempHP = (currentTempHP ?? 0) + (currentHP - newMaxHP);
    newHP = newMaxHP;
  }

  const statUpdate = {
    "system.abilities.str": foundry.utils.deepClone(p.abilities.str),
    "system.abilities.dex": foundry.utils.deepClone(p.abilities.dex),
    "system.abilities.con": foundry.utils.deepClone(p.abilities.con),
    "system.abilities.int": foundry.utils.deepClone(p.abilities.int),
    "system.abilities.wis": foundry.utils.deepClone(p.abilities.wis),
    "system.abilities.cha": foundry.utils.deepClone(p.abilities.cha),
    "system.attributes.hp.value": newHP,
    "system.attributes.hp.temp": newTempHP,
    "system.attributes.movement": foundry.utils.deepClone(p.attributes.movement),
    "system.traits.size": p.traits.size,
    "system.traits.languages": foundry.utils.deepClone(p.traits.languages),
    "system.traits.dr": foundry.utils.deepClone(p.traits.dr),
    "system.traits.di": foundry.utils.deepClone(p.traits.di),
    "system.traits.dv": foundry.utils.deepClone(p.traits.dv),
    "system.traits.ci": foundry.utils.deepClone(p.traits.ci),
    "system.details.race": foundry.utils.deepClone(p.details.race ?? {}),
    "system.details.background": p.details.background ?? "",
    "system.details.alignment": p.details.alignment ?? "",
    "system.details.biography": foundry.utils.deepClone(p.details.biography ?? {}),
    "name": `${MASTER_PREFIX} ${personalityActor.name}`,
    "img": personalityActor.img
  };

  // ── 3. Flash effect ──
  await flashEffect(token);

  // ── 4. Delete all non-inventory items from master ──
  const toDelete = getNonInventoryItems(masterActor).map(i => i.id);
  if (toDelete.length > 0) {
    await masterActor.deleteEmbeddedDocuments("Item", toDelete);
  }

  // ── 5. Apply stat update ──
  await masterActor.update(statUpdate);

  // ── 6. Copy non-inventory items from personality to master ──
  const newItems = getNonInventoryItems(personalityActor).map(i => i.toObject());
  if (newItems.length > 0) {
    await masterActor.createEmbeddedDocuments("Item", newItems);
  }

  // ── 7. Restore inventory and currency (in case anything got wiped) ──
  const currentInventoryIds = getInventoryItems(masterActor).map(i => i.id);
  if (currentInventoryIds.length === 0 && inventoryItems.length > 0) {
    await masterActor.createEmbeddedDocuments("Item", inventoryItems);
  }
  await masterActor.update({ "system.currency": currency });

  // ── 8. Update token image ──
  await token.document.update({
    texture: { src: personalityActor.prototypeToken?.texture?.src ?? personalityActor.img }
  });

  // ── 9. Second flash to reveal ──
  await new Promise(r => setTimeout(r, 150));
  await flashEffect(token);

  // ── 10. Pan to token ──
  canvas.animatePan({
    x: token.center.x,
    y: token.center.y,
    duration: 400
  });

  // ── 11. Dramatic chat card ──
  await ChatMessage.create({
    content: `
      <div style="background:#1a1a2e;border:1px solid #7a4aaa;border-radius:8px;padding:10px;font-family:Georgia,serif;color:#f0e6d3;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;border-bottom:1px solid #7a4aaa;padding-bottom:8px;">
          <img src="${personalityActor.img}" width="36" height="36" style="border-radius:50%;border:2px solid #7a4aaa"/>
          <strong style="font-size:1.1em;">⚡ Personality Shift</strong>
        </div>
        <p style="margin:4px 0;font-size:0.9em;font-style:italic;">
          Something shifts behind their eyes. <strong>${personalityActor.name}</strong> surfaces.
        </p>
        <p style="margin:4px 0;font-size:0.85em;color:#c8a97e;">
          HP: <strong>${newHP}/${newMaxHP}</strong>
          ${newTempHP > 0 ? `&nbsp;|&nbsp; Temp HP: <strong>${newTempHP}</strong>` : ""}
        </p>
      </div>
    `
  });

  ui.notifications.info(`⚡ SoulShift | Now playing as ${personalityActor.name}`);
}

// ─────────────────────────────────────────────
// DIALOG — pick which personality to shift to
// ─────────────────────────────────────────────
async function openShiftDialog(masterActor) {
  const personalities = PERSONALITY_NAMES
    .map(name => game.actors.getName(name))
    .filter(a => a !== undefined);

  if (personalities.length === 0) {
    return ui.notifications.error("SoulShift | No personality actors found. Check PERSONALITY_NAMES in soulshift.js");
  }

  const options = personalities.map(a => `
    <div class="soulshift-option" data-actor-id="${a.id}" style="
      display:flex;align-items:center;gap:12px;padding:8px;
      border:1px solid #7a4aaa;border-radius:6px;cursor:pointer;
      margin-bottom:8px;background:#1a1a2e;color:#f0e6d3;
      font-family:Georgia,serif;
    ">
      <img src="${a.img}" width="40" height="40" style="border-radius:50%;border:2px solid #7a4aaa;object-fit:cover"/>
      <div>
        <div style="font-weight:bold;font-size:1em;">${a.name}</div>
        <div style="font-size:0.8em;color:#c8a97e;">
          ${a.system.details.race ?? ""} — 
          HP ${a.system.attributes.hp.max} max
        </div>
      </div>
    </div>
  `).join("");

  const content = `
    <div style="padding:8px;">
      <p style="font-family:Georgia,serif;color:#c8a97e;margin-bottom:12px;font-size:0.9em;">
        Choose which personality surfaces...
      </p>
      ${options}
    </div>
    <style>
      .soulshift-option:hover { background: #2a1a3e !important; border-color: #aa6aee !important; }
    </style>
  `;

  const { DialogV2 } = foundry.applications.api;
  await DialogV2.prompt({
    window: { title: "⚡ Personality Shift" },
    content,
    ok: {
      label: "Cancel",
      callback: () => {}
    },
    render: (event, html) => {
      html.querySelectorAll(".soulshift-option").forEach(el => {
        el.addEventListener("click", async () => {
          const actorId = el.dataset.actorId;
          const personality = game.actors.get(actorId);
          if (!personality) return;

          // Close the dialog
          const dialog = html.closest(".application");
          dialog?.querySelector("[data-action='ok']")?.click();

          await shiftPersonality(masterActor, personality);
        });
      });
    }
  });
}

// ─────────────────────────────────────────────
// HOOK — intercept the Shift Personality activity
// ─────────────────────────────────────────────
Hooks.on("dnd5e.postCreateUsageMessage", async (activity) => {
  if (activity?.name !== "Shift Personality") return;

  const item = activity.item;
  const actor = item?.actor;
  if (!actor) return;

  // Check this actor has the master prefix
  if (!actor.name.startsWith(MASTER_PREFIX) && !PERSONALITY_NAMES.includes(actor.name)) {
    // Also allow if actor has a soulshift flag
    const isMaster = actor.getFlag("soulshift", "isMaster");
    if (!isMaster) return;
  }

  await openShiftDialog(actor);
});

// ─────────────────────────────────────────────
// HOOK — right-click token menu option for DM
// ─────────────────────────────────────────────
Hooks.on("getTokenContextOptions", (html, options) => {
  options.push({
    name: "⚡ Shift Personality",
    icon: '<i class="fas fa-masks-theater"></i>',
    condition: token => {
      if (!game.user.isGM) return false;
      const actor = token.actor;
      return actor?.name.startsWith(MASTER_PREFIX) ||
             actor?.getFlag("soulshift", "isMaster") === true;
    },
    callback: token => openShiftDialog(token.actor)
  });
});