const V = require('../lib/validate');
const pipeline = require('../services/pipeline');

/**
 * "Otomatik Üretim": reading is open to every signed-in role; switching it on or off, the pace, "start now" and "give up this cycle" need the bot-control permission (they decide whether
 * articles are published without anybody looking). Turning it on answers 409 { requiresConfirmation } until the request says `confirm: true`.
 */
module.exports = function pipelineRoutes(r, { wrap, mw, A }) {
  r.get('/pipeline', wrap(async (req, res) => res.json(await pipeline.overview(V.uuid(req.query.projectId, 'Proje')))));
  r.put('/pipeline', mw.need('bots.control'), wrap(async (req, res) => {
    const pid = V.uuid(req.body.projectId, 'Proje'); const before = await pipeline.config(pid);
    const out = await pipeline.setConfig(pid, req.body, { userId: req.cu.user.id });
    await A(req, 'pipeline.config', 'project', pid, before, { enabled: out.enabled, everyMinutes: out.everyMinutes, changes: out.changes });
    res.json(out);
  }));
  r.post('/pipeline/start', mw.need('bots.control'), wrap(async (req, res) => {
    const pid = V.uuid(req.body.projectId, 'Proje'); const out = await pipeline.start(pid, { userId: req.cu.user.id });
    await A(req, 'pipeline.start', 'project', pid); res.json(out);
  }));
  r.post('/pipeline/cancel', mw.need('bots.control'), wrap(async (req, res) => {
    const pid = V.uuid(req.body.projectId, 'Proje'); const out = await pipeline.cancel(pid);
    await A(req, 'pipeline.cancel', 'project', pid); res.json(out);
  }));
};
