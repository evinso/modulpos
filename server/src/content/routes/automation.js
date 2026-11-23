const V = require('../lib/validate');
const automation = require('../services/automation');
const live = require('../services/automationLive');
const flow = require('../services/flow');
const cleanup = require('../services/cleanup');

/**
 * "Otomasyon Modu": reading is open to every signed-in role, changing it is admin only (it switches bots, publishing, limits and the budget).
 * The switches that remove the person from the loop (auto-approval, publishing live) answer 409 { requiresConfirmation } until the request says `confirm: true`.
 */
module.exports = function automationRoutes(r, { wrap, mw, A }) {
  r.get('/automation', wrap(async (req, res) => res.json(await automation.overview(V.uuid(req.query.projectId, 'Proje')))));
  /** the live picture (which bot works on what, the queue, the latest results): read only, open to every signed-in role; the panel asks every few seconds */
  r.get('/automation/live', wrap(async (req, res) => res.json(await live.live(V.uuid(req.query.projectId, 'Proje')))));
  /** how what the system finds becomes articles, the waves of fresh news, and the housekeeping (read only; every role) */
  r.get('/automation/flow', wrap(async (req, res) => res.json(await flow.overview(V.uuid(req.query.projectId, 'Proje')))));
  r.put('/automation/flow', mw.need('bots.control'), wrap(async (req, res) => {
    const pid = V.uuid(req.body.projectId, 'Proje'); const before = await flow.overview(pid);
    const out = await flow.save(pid, req.body, { userId: req.cu.user.id });
    await A(req, 'automation.flow', 'project', pid, { freshHours: before.fresh.hours, retention: before.cleanup.rules }, { freshHours: out.fresh.hours, retention: out.cleanup.rules });
    res.json(out);
  }));
  /** removes what the housekeeping would remove, now (the card shows the numbers first) */
  r.post('/automation/cleanup', mw.need('bots.control'), wrap(async (req, res) => {
    const pid = V.uuid(req.body.projectId, 'Proje'); const done = await cleanup.run(pid, { trigger: 'manual' });
    await A(req, 'automation.cleanup', 'project', pid, null, done.removed);
    res.json({ removed: done.removed, flow: await flow.overview(pid) });
  }));
  r.put('/automation', mw.need('bots.control'), wrap(async (req, res) => {
    const before = await automation.overview(V.uuid(req.body.projectId, 'Proje'));
    const out = await automation.apply(req.body, { userId: req.cu.user.id });
    const on = (o) => o.options.filter((x) => x.on).map((x) => x.key);
    await A(req, 'automation.apply', 'project', out.projectId, { mode: before.mode, on: on(before), values: before.values }, { mode: out.mode, on: on(out), values: out.values, changes: out.applied.changes, skipped: out.applied.skipped.map((s) => s.key) });
    res.json(out);
  }));
};
