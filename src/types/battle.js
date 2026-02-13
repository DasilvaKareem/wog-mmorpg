/** Default actions available to all combatants */
export const ACTIONS = {
    attack: { kind: "attack", name: "Attack", baseDelay: 20, power: 1.0 },
    heavy: { kind: "skill", name: "Heavy Strike", baseDelay: 40, power: 1.8 },
    quick: { kind: "skill", name: "Quick Slash", baseDelay: 10, power: 0.6 },
    defend: { kind: "defend", name: "Defend", baseDelay: 8, power: 0 },
    potion: { kind: "item", name: "Health Potion", baseDelay: 12, power: 30 },
    flee: { kind: "flee", name: "Flee", baseDelay: 0, power: 0 },
};
