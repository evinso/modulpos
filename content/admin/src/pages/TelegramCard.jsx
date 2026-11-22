import { useState } from 'react';
import { Send } from 'lucide-react';
import { api, API_ORIGIN } from '../api.js';
import { Alert, Async, Badge, Card, Check, Field, useAction, useApp, useLoad } from '../ui.jsx';
import { dt } from '../format.js';

const NOTIFY = [['newArticle', 'Yeni makale taslağı hazır'], ['critical', 'Kritik düzeltme gerekiyor'], ['budget', 'API bütçesi doldu'], ['publishError', 'WordPress yayın hatası'], ['adsense', 'AdSense riski (makale ve site)'], ['botError', 'Bot hatası / bot kapandı']];

/** Telegram: the bot's state, the webhook, and which notifications go to the chat (admin only; the token lives in "API Kullanımı") */
export default function TelegramCard() {
  const { toast } = useApp();
  const st = useLoad(() => api.get('/telegram/status'), []);
  const [run, busy] = useAction(); const [info, setInfo] = useState(null); const [base, setBase] = useState(API_ORIGIN.startsWith('https://') ? API_ORIGIN : '');
  const act = async (fn, ok) => { const r = await run(fn, ok); st.reload(); return r; };
  return (
    <Card flat title="Telegram" actions={st.data && (st.data.configured ? <Badge kind="ok">Bot belirteci kayıtlı</Badge> : <Badge>Bağlı değil</Badge>)}>
      <Async state={st}>{(d) => (!d.configured ? (
        <Alert kind="info" title="Telegram bağlı değil">Telegram’dan bildirim almak ve komut vermek için: Telegram’da <strong>@BotFather</strong> ile bir bot oluşturun, belirteci “API Kullanımı ve Maliyetler → Telegram” kartına yapıştırın. Sonra bota <code>/start</code> yazın: size sohbet kimliğinizi söyler; onu aynı karttaki “Yetkili sohbet kimlikleri” alanına yazın. Ücretsizdir.</Alert>
      ) : (
        <div className="stack">
          <div className="row">
            {d.bot ? <Badge kind="ok">@{d.bot.username}</Badge> : <Badge>bot adı henüz okunmadı (API Kullanımı → Bağlantıyı test et)</Badge>}
            <Badge kind={d.chatIds.length ? 'ok' : 'warn'}>{d.chatIds.length} yetkili sohbet</Badge>
            {d.webhook ? <Badge kind="ok">webhook kurulu</Badge> : <Badge kind="warn">webhook kurulu değil: komutlar çalışmaz</Badge>}
          </div>
          {!d.chatIds.length && <Alert kind="warn">Yetkili sohbet kimliği yazılmamış: bildirim gitmez, komutlar yanıtlanmaz. Bota <code>/start</code> yazın, söylediği sayıyı “API Kullanımı → Telegram” kartına ekleyin.</Alert>}
          <Field label="API’nin herkese açık adresi (Telegram buraya gönderir)" hint="https ile başlamalı, örn. https://api.modulpos.com. Boş bırakırsanız panelin bu sayfayı açtığı API adresi kullanılır."><input className="input" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://api.alanadiniz.com" aria-label="API adresi" autoComplete="off" /></Field>
          <div className="row">
            <button className="btn sm" disabled={busy || !d.chatIds.length} onClick={() => act(() => api.post('/telegram/test-message'), 'Test mesajı gönderildi (Telegram’ı kontrol edin)')}><Send size={14} />Test mesajı gönder</button>
            <button className="btn sm" disabled={busy} onClick={() => act(() => api.post('/telegram/webhook/set', base.trim() ? { baseUrl: base.trim() } : {}), 'Webhook kuruldu')}>{d.webhook ? 'Webhook’u yeniden kur' : 'Webhook’u kur (komutları aç)'}</button>
            {d.webhook && <button className="btn sm" disabled={busy} onClick={async () => { const r = await run(() => api.get('/telegram/webhook/info')); if (r) setInfo(r); }}>Telegram’ın gördüğü durum</button>}
            {d.webhook && <button className="btn sm ghost" disabled={busy} onClick={() => act(() => api.post('/telegram/webhook/delete'), 'Webhook kaldırıldı')}>Webhook’u kaldır</button>}
          </div>
          {d.webhook && <small className="faint">Webhook: {d.webhook.url} · kuruldu {dt(d.webhook.setAt)}</small>}
          {info && <Alert kind={info.lastError ? 'warn' : 'ok'} title="Telegram’ın bildirdiği">Bekleyen güncelleme: {info.pending}. {info.lastError ? `Son hata: ${info.lastError}${info.lastErrorAt ? ` (${dt(info.lastErrorAt)})` : ''}` : 'Son hata yok.'}</Alert>}
          <div><strong>Hangi bildirimler Telegram’a gitsin?</strong>
            <div className="stack" style={{ marginTop: 6 }}>{NOTIFY.map(([k, label]) => <Check key={k} checked={d.notify[k]} disabled={busy} onChange={(v) => act(() => api.put('/settings/telegram', { value: { notify: { ...d.notify, [k]: v } } }), 'Kaydedildi')}>{label}</Check>)}</div>
            <small className="faint">Her bildirim yine bu sayfada saklanır. Aynı mesaj 10 dakika içinde tekrar gönderilmez; saatte en çok {d.hourlyCap} mesaj gider{d.suppressed ? ` (bu çalışmada ${d.suppressed} mesaj tutuldu)` : ''}.</small></div>
          {d.lastForward && <small className="faint">Son gönderim: {dt(d.lastForward.at)} — {d.lastForward.ok} sohbete gitti{d.lastForward.failed ? `, ${d.lastForward.failed} sohbete gitmedi (${d.lastForward.error})` : ''}.</small>}
          <small className="faint">Komutlar (yalnızca yetkili sohbetlerden): {d.commands.join(' ')} · <code>/pause</code>, <code>/resume</code> ve <code>/generate onay</code> bir şeyi değiştirir; 10 dakikadan eski böyle bir komut çalıştırılmaz. Taslaklar hiçbir zaman Telegram’dan yayımlanmaz.</small>
        </div>
      ))}</Async>
    </Card>
  );
}
