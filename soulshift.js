Hooks.once("init", () => {
  console.log("SoulShift | Initialised");
});

const SOUL_ANCHOR_NAME = "Soul Anchor";

// ─────────────────────────────────────────────
// Add config button to item sheets
// ─────────────────────────────────────────────
function addSoulAnchorConfigButton(app, html) {
  if (!game.user.isGM) return;

  const item = app.item ?? app.document;
  if (!item || item.name !== SOUL_ANCHOR_NAME) return;

  const $html = html instanceof jQuery ? html : $(html.element ?? html);
  if ($html.find(".soulshift-config").length > 0) return;

  const menu = $html.find("menu.controls-dropdown");
  if (!menu.length) return;

  const menuItem = $(`
    <li class="header-control">
      <button type="button" class="control soulshift-config">
        <i class="control-icon fa-fw fa-solid fa-masks-theater"></i>
        <span class="control-label">Soul Config</span>
      </button>
    </li>
  `);

  menu.append(menuItem);
  menuItem.find("button").on("click", () => openSoulAnchorConfig(item));
}

Hooks.on("renderItemSheet", addSoulAnchorConfigButton);
Hooks.on("renderTidy5eItemSheetQuadrone", addSoulAnchorConfigButton);

// ─────────────────────────────────────────────
// Open the Soul Anchor config dialog
// ─────────────────────────────────────────────
async function openSoulAnchorConfig(item) {
  const saved = item.getFlag("soulshift", "config") ?? {
    masterPrefix: "M.",
    personalityIds: []
  };

  // Build personality data for template
  const personalities = (saved.personalityIds ?? [])
    .map(id => game.actors.get(id))
    .filter(a => a !== undefined)
    .map(a => ({ id: a.id, name: a.name, img: a.img }));

  // All actors for the dropdown (exclude the master actor itself)
  const masterActor = item.actor;
  const allActors = game.actors
    .filter(a => a.id !== masterActor?.id && a.type === "character")
    .map(a => ({ id: a.id, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const content = await foundry.applications.handlebars.renderTemplate(
    "modules/soulshift/templates/soul-anchor-config.html",
    { personalities, allActors, masterPrefix: saved.masterPrefix ?? "M." }
  );

  const { DialogV2 } = foundry.applications.api;
  await DialogV2.prompt({
    window: { title: `⚡ Soul Anchor Config — ${item.actor?.name ?? item.name}` },
    content,
    ok: {
      label: "Save",
      callback: async (event, button) => {
        const form = button.form
          ?? button.closest("form")
          ?? button.closest(".window-content")?.querySelector("form");

        if (!form) return ui.notifications.error("SoulShift | Could not find config form.");

        const masterPrefix = form.masterPrefix?.value ?? "M.";
        const idInputs = [...form.querySelectorAll("input[name='personalityIds']")];
        const personalityIds = idInputs.map(el => el.value).filter(Boolean);

        await item.setFlag("soulshift", "config", { masterPrefix, personalityIds });
        ui.notifications.info(`SoulShift | Soul Anchor configured with ${personalityIds.length} personalit${personalityIds.length !== 1 ? "ies" : "y"}.`);
      }
    }
  });
}

// ─────────────────────────────────────────────
// HELPER — flash effect
// ─────────────────────────────────────────────
async function flashEffect(token) {
  const flash = new PIXI.Graphics();
  flash.beginFill(0xffffff, 0.9);
  flash.drawRect(
    token.x, token.y,
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
// HELPER — inventory vs non-inventory items
// ─────────────────────────────────────────────
const INVENTORY_TYPES = ["weapon", "equipment", "consumable", "loot", "tool", "container"];

function getInventoryItems(actor) {
  return actor.items.filter(i => INVENTORY_TYPES.includes(i.type));
}

function getNonInventoryItems(actor) {
  return actor.items.filter(i =>
    !INVENTORY_TYPES.includes(i.type) && i.name !== SOUL_ANCHOR_NAME
  );
}

// ─────────────────────────────────────────────
// CORE — perform the personality shift
// ─────────────────────────────────────────────
async function shiftPersonality(masterActor, personalityActor, masterPrefix) {
  const token = canvas.tokens.placeables.find(t => t.actor?.id === masterActor.id);
  if (!token) {
    return ui.notifications.error("SoulShift | Master actor token not found on this scene.");
  }

  // Keep from master
  const currentHP = masterActor.system.attributes.hp.value;
  const currentTempHP = masterActor.system.attributes.hp.temp ?? 0;
  const inventoryItems = getInventoryItems(masterActor).map(i => i.toObject());
  const currency = foundry.utils.deepClone(masterActor.system.currency);

  // HP overflow → temp HP
  const newMaxHP = personalityActor.system.attributes.hp.max;
  let newHP = currentHP;
  let newTempHP = currentTempHP;
  if (currentHP > newMaxHP) {
    newTempHP = currentTempHP + (currentHP - newMaxHP);
    newHP = newMaxHP;
  }

  const p = personalityActor.system;

  const statUpdate = {
    name: `${masterPrefix} ${personalityActor.name}`,
    img: personalityActor.img,
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
    "system.details.alignment": p.details.alignment ?? "",
    "system.details.biography": foundry.utils.deepClone(p.details.biography ?? {}),
    "system.currency": currency
  };

  // Flash out
  await flashEffect(token);

  // Delete non-inventory items from master (keeps Soul Anchor and inventory)
  const toDelete = getNonInventoryItems(masterActor).map(i => i.id);
  if (toDelete.length > 0) {
    await masterActor.deleteEmbeddedDocuments("Item", toDelete);
  }

  // Apply stat update
  await masterActor.update(statUpdate);

  // Copy non-inventory items from personality
  const newItems = getNonInventoryItems(personalityActor).map(i => i.toObject());
  if (newItems.length > 0) {
    await masterActor.createEmbeddedDocuments("Item", newItems);
  }

  // Update token image
  await token.document.update({
    "texture.src": personalityActor.prototypeToken?.texture?.src ?? personalityActor.img,
    "name": `${masterPrefix} ${personalityActor.name}`
  });

  // Flash in
  await new Promise(r => setTimeout(r, 150));
  await flashEffect(token);

  // Pan camera
  canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 400 });

  // Chat card
  await ChatMessage.create({
    content: `
      <div style="background:#1a1a2e;border:1px solid #7a4aaa;border-radius:8px;padding:10px;font-family:Georgia,serif;color:#f0e6d3;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;border-bottom:1px solid #7a4aaa;padding-bottom:8px;">
          <img src="${personalityActor.img}" width="36" height="36" style="border-radius:50%;border:2px solid #7a4aaa;object-fit:cover"/>
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
async function openShiftDialog(masterActor, anchorConfig) {
  const { personalityIds, masterPrefix } = anchorConfig;

  const personalities = (personalityIds ?? [])
    .map(id => game.actors.get(id))
    .filter(a => a !== undefined);

  if (personalities.length === 0) {
    return ui.notifications.error("SoulShift | No personalities configured. Open the Soul Anchor item and add personalities via Soul Config.");
  }

  const options = personalities.map(a => `
    <div class="ss-shift-option" data-actor-id="${a.id}" style="
      display:flex;align-items:center;gap:12px;padding:8px;
      border:1px solid #7a4aaa;border-radius:6px;cursor:pointer;
      margin-bottom:8px;background:#1a1a2e;color:#f0e6d3;
      font-family:Georgia,serif;transition:background 0.15s;
    ">
      <img src="${a.img}" width="44" height="44" style="border-radius:50%;border:2px solid #7a4aaa;object-fit:cover"/>
      <div>
        <div style="font-weight:bold;font-size:1em;">${a.name}</div>
        <div style="font-size:0.8em;color:#c8a97e;">
          HP max: ${a.system.attributes.hp.max}
        </div>
      </div>
    </div>
  `).join("");

  const content = `
    <div style="padding:8px;">
      <p style="font-family:Georgia,serif;color:#c8a97e;margin-bottom:12px;font-size:0.9em;font-style:italic;">
        Which personality surfaces?
      </p>
      ${options}
    </div>
    <style>
      .ss-shift-option:hover { background:#2a1a3e !important; border-color:#aa6aee !important; }
    </style>
  `;

  const { DialogV2 } = foundry.applications.api;
  await DialogV2.prompt({
    window: { title: "⚡ Personality Shift" },
    content,
    ok: { label: "Cancel", callback: () => {} },
    render: (event, html) => {
      html.querySelectorAll(".ss-shift-option").forEach(el => {
        el.addEventListener("click", async () => {
          const personality = game.actors.get(el.dataset.actorId);
          if (!personality) return;
          html.closest(".application")?.querySelector("[data-action='ok']")?.click();
          await shiftPersonality(masterActor, personality, masterPrefix ?? "M.");
        });
      });
    }
  });
}

// ─────────────────────────────────────────────
// HOOK — fire on Soul Anchor activity use
// ─────────────────────────────────────────────
Hooks.on("dnd5e.postCreateUsageMessage", async (activity) => {
  if (activity?.name !== "Shift Personality") return;

  const item = activity.item;
  if (!item || item.name !== SOUL_ANCHOR_NAME) return;

  const actor = item.actor;
  if (!actor) return;

  const config = item.getFlag("soulshift", "config");
  if (!config?.personalityIds?.length) {
    return ui.notifications.error("SoulShift | Soul Anchor has no personalities configured. Open Soul Config to add some.");
  }

  await openShiftDialog(actor, config);
});

// ─────────────────────────────────────────────
// HOOK — DM right-click token option
// ─────────────────────────────────────────────
Hooks.on("getTokenContextOptions", (html, options) => {
  options.push({
    name: "⚡ Shift Personality",
    icon: '<i class="fas fa-masks-theater"></i>',
    condition: token => {
      if (!game.user.isGM) return false;
      return token.actor?.items.some(i => i.name === SOUL_ANCHOR_NAME);
    },
    callback: token => {
      const anchor = token.actor.items.find(i => i.name === SOUL_ANCHOR_NAME);
      const config = anchor?.getFlag("soulshift", "config");
      if (!config) return ui.notifications.error("SoulShift | No Soul Anchor config found.");
      openShiftDialog(token.actor, config);
    }
  });
});