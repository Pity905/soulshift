Hooks.once("init", () => {
  console.log("SoulShift | Initialised");
});

const INVENTORY_TYPES = ["weapon", "equipment", "consumable", "loot", "tool", "container"];

function getInventoryItems(actor) {
  return actor.items.filter(i => INVENTORY_TYPES.includes(i.type));
}

function getNonInventoryItems(actor, anchorItemId) {
  return actor.items.filter(i =>
    !INVENTORY_TYPES.includes(i.type) && i.id !== anchorItemId
  );
}

// ─────────────────────────────────────────────
// Add Soul Config button to ALL item sheets
// ─────────────────────────────────────────────
function addSoulConfigButton(app, html) {
  if (!game.user.isGM) return;

  const item = app.item ?? app.document;
  if (!item) return;

  // Only show on feature type items
  if (item.type !== "feat") return;

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
  menuItem.find("button").on("click", () => openSoulConfig(item));
}

Hooks.on("renderItemSheet", addSoulConfigButton);
Hooks.on("renderTidy5eItemSheetQuadrone", addSoulConfigButton);


function attachRemoveListeners(root) {
  root.querySelectorAll(".ss-remove-personality").forEach(btn => {
    btn.onclick = () => {
      btn.closest(".ss-personality-entry").remove();
      if (!root.querySelectorAll(".ss-personality-entry").length) {
        const list = root.querySelector("#ss-personality-list");
        const p = document.createElement("p");
        p.id = "ss-no-personalities";
        p.style.cssText = "color:#888;font-size:0.85em;font-style:italic;";
        p.textContent = "No personalities linked yet.";
        list.appendChild(p);
      }
    };
  });
}

// ─────────────────────────────────────────────
// Open Soul Config dialog
// ─────────────────────────────────────────────
async function openShiftDialog(masterActor, anchorItem) {
  const config = anchorItem.getFlag("soulshift", "config");
  if (!config?.personalityIds?.length) {
    return ui.notifications.error("SoulShift | No personalities configured. Open Soul Config on the item.");
  }

  const { personalityIds, masterPrefix } = config;
  const personalities = (personalityIds ?? [])
    .map(id => game.actors.get(id))
    .filter(a => a !== undefined);

  if (personalities.length === 0) {
    return ui.notifications.error("SoulShift | Linked personality actors not found. Check Soul Config.");
  }

  const options = personalities.map(a => `
    <div class="ss-shift-option" data-actor-id="${a.id}" style="
      display:flex;align-items:center;gap:12px;padding:8px;
      border:1px solid #7a4aaa;border-radius:6px;cursor:pointer;
      margin-bottom:8px;background:#1a1a2e;color:#f0e6d3;font-family:Georgia,serif;
    ">
      <img src="${a.img}" width="44" height="44" style="border-radius:50%;border:2px solid #7a4aaa;object-fit:cover"/>
      <div>
        <div style="font-weight:bold;">${a.name}</div>
        <div style="font-size:0.8em;color:#c8a97e;">HP max: ${a.system.attributes.hp.max}</div>
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
    <style>.ss-shift-option:hover { background:#2a1a3e !important; border-color:#aa6aee !important; }</style>
  `;

  const { DialogV2 } = foundry.applications.api;
  await DialogV2.prompt({
    window: { title: "⚡ Personality Shift" },
    content,
    ok: { label: "Cancel", callback: () => {} },
    render: (event, dialog) => {
      const root = dialog.element ?? dialog;
      root.querySelectorAll(".ss-shift-option").forEach(el => {
        el.addEventListener("click", async () => {
          const personality = game.actors.get(el.dataset.actorId);
          if (!personality) return;
          root.closest(".application")?.querySelector("[data-action='ok']")?.click();
          await shiftPersonality(masterActor, personality, anchorItem.id, masterPrefix ?? "M.");
        });
      });
    }
  });
}

// ─────────────────────────────────────────────
// Flash effect
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
// Core shift logic
// ─────────────────────────────────────────────
async function shiftPersonality(masterActor, personalityActor, anchorItemId, masterPrefix) {
  const token = canvas.tokens.placeables.find(t => t.actor?.id === masterActor.id);
  if (!token) {
    return ui.notifications.error("SoulShift | Master actor token not found on this scene.");
  }

  const currentHP = masterActor.system.attributes.hp.value;
  const currentTempHP = masterActor.system.attributes.hp.temp ?? 0;
  const currency = foundry.utils.deepClone(masterActor.system.currency);

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

  // Delete non-inventory items except the anchor item itself
  const toDelete = getNonInventoryItems(masterActor, anchorItemId).map(i => i.id);
  if (toDelete.length > 0) {
    await masterActor.deleteEmbeddedDocuments("Item", toDelete);
  }

  // Apply stat update
  await masterActor.update(statUpdate);

  // Copy non-inventory items from personality
  const newItems = getNonInventoryItems(personalityActor, null).map(i => i.toObject());
  if (newItems.length > 0) {
    await masterActor.createEmbeddedDocuments("Item", newItems);
  }

  // Update token image and name
  await token.document.update({
    "texture.src": personalityActor.prototypeToken?.texture?.src ?? personalityActor.img,
    "name": `${masterPrefix} ${personalityActor.name}`
  });

  // Flash in
  await new Promise(r => setTimeout(r, 150));
  await flashEffect(token);

  canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 400 });

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
// Shift dialog
// ─────────────────────────────────────────────
async function openShiftDialog(masterActor, anchorItem) {
  const config = anchorItem.getFlag("soulshift", "config");
  if (!config?.personalityIds?.length) {
    return ui.notifications.error("SoulShift | No personalities configured. Open Soul Config on the item.");
  }

  const { personalityIds, masterPrefix } = config;
  const personalities = (personalityIds ?? [])
    .map(id => game.actors.get(id))
    .filter(a => a !== undefined);

  if (personalities.length === 0) {
    return ui.notifications.error("SoulShift | Linked personality actors not found. Check Soul Config.");
  }

  const options = personalities.map(a => `
    <div class="ss-shift-option" data-actor-id="${a.id}" style="
      display:flex;align-items:center;gap:12px;padding:8px;
      border:1px solid #7a4aaa;border-radius:6px;cursor:pointer;
      margin-bottom:8px;background:#1a1a2e;color:#f0e6d3;font-family:Georgia,serif;
    ">
      <img src="${a.img}" width="44" height="44" style="border-radius:50%;border:2px solid #7a4aaa;object-fit:cover"/>
      <div>
        <div style="font-weight:bold;">${a.name}</div>
        <div style="font-size:0.8em;color:#c8a97e;">HP max: ${a.system.attributes.hp.max}</div>
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
    <style>.ss-shift-option:hover { background:#2a1a3e !important; border-color:#aa6aee !important; }</style>
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
          await shiftPersonality(masterActor, personality, anchorItem.id, masterPrefix ?? "M.");
        });
      });
    }
  });
}

// ─────────────────────────────────────────────
// Hook — fire on Shift Personality activity use
// ─────────────────────────────────────────────
Hooks.on("dnd5e.postCreateUsageMessage", async (activity) => {
  if (activity?.name !== "Shift Personality") return;

  const item = activity.item;
  if (!item) return;

  // Only fire if this item has soulshift config
  const config = item.getFlag("soulshift", "config");
  if (!config) return;

  const actor = item.actor;
  if (!actor) return;

  await openShiftDialog(actor, item);
});

// ─────────────────────────────────────────────
// Hook — DM right-click token option
// ─────────────────────────────────────────────
Hooks.on("getTokenContextOptions", (html, options) => {
  options.push({
    name: "⚡ Shift Personality",
    icon: '<i class="fas fa-masks-theater"></i>',
    condition: token => {
      if (!game.user.isGM) return false;
      return token.actor?.items.some(i => i.getFlag("soulshift", "config"));
    },
    callback: token => {
      const anchor = token.actor.items.find(i => i.getFlag("soulshift", "config"));
      if (!anchor) return ui.notifications.error("SoulShift | No configured item found.");
      openShiftDialog(token.actor, anchor);
    }
  });
});