const V = require('../lib/validate');
const automation = require('../services/automation');

/**
 * "Otomasyon Modu": reading is open to every signed-in role, changing it is admin only (it switches bots, publishing, limits and the budget).
 * The switches that remove the person from the loop (auto-approval, publishing live) answer 409 { requiresConfirmation } until the request says `confirm: true`.
 */
module.exports = function automationRoutes(r, { wrap, mw, A }) {
  r.get('/automation', wrap(async (req, res) => res.json(await automation.overview(V.uuid(req.query.projectId, 'Proje')))));
  r.put('/automation', mw.need('bots.control'), wrap(async (req, res) => {
    const before = await automation.overview(V.uuid(req.body.projectId, 'Proje'));
    const out = await automation.apply(req.body, { userId: req.cu.user.id });
    const on = (o) => o.options.filter((x) => x.on).map((x) => x.key);
    await A(req, 'automation.apply', 'project', out.projectId, { mode: before.mode, on: on(before), values: before.values }, { mode: out.mode, on: on(out), values: out.values, changes: out.applied.changes, skipped: out.applied.skipped.map((s) => s.key) });
    res.json(out);
  }));
};
