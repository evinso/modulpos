// End-to-end test against a RUNNING deployment. It creates temporary users/stores and removes them afterwards.
//   E2E_DB_URL=postgresql://...:5432/postgres  [API_URL=https://api.modulpos.com/api]  node test/e2e/<file>
// Needs the "pg" dev dependency. Do not run against a database whose "app" schema holds data you cannot afford to touch.
const {Client}=require("pg");
const { registerFetch } = require('./_register');
const API=process.env.API_URL||"https://api.modulpos.com/api";
(async()=>{
 const c=new Client({connectionString:process.env.E2E_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
 let fails=0; const ok=(n,cnd,x)=>{console.log((cnd?"PASS":"FAIL")+"  "+n+(x?"  → "+x:""));if(!cnd)fails++};
 const mk=async(tag)=>registerFetch(API+"/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:`tmp-${tag}-${Date.now()}@example.invalid`,password:"Passw0rd!test",name:tag})}).then(r=>r.json());
 const A=await mk("e2eA"), B=await mk("e2eB");
 const call=(tok)=>async(m,u,b)=>{const r=await fetch(API+u,{method:m,headers:{"Content-Type":"application/json",Authorization:"Bearer "+tok},body:b?JSON.stringify(b):undefined});let d;try{d=await r.json()}catch{};return {s:r.status,d}};
 const a=call(A.token), b=call(B.token); const store=A.user.stores[0];
 try{
  const real={url:'https://raw.githubusercontent.com/evinso/modulpos/main/server/test/fixtures/feed-google.xml',mappingConfig:null}; // synthetic feed: the suite must not depend on anyone's real source
  let r=await a("POST","/xml-sources",{name:"e2e",url:real.url,mappingConfig:real.mappingConfig,defaultVatRate:20,syncIntervalMin:60});
  ok("create source",r.s===201); const srcId=r.d.id;
  const waitSync=async(tok)=>{ await tok("POST",`/xml-sources/${srcId}/sync`); for(let i=0;i<120;i++){await new Promise(x=>setTimeout(x,1500));const s=await tok("GET",`/xml-sources/${srcId}/sync-status`);if(!s.d.running&&s.d.last.status!=="started")return s.d.last}};
  let t=Date.now(); let log=await waitSync(a);
  ok("sync completed",log.status==="completed",`${((Date.now()-t)/1000).toFixed(1)}s created=${log.created}`);
  const prods=(await c.query(`select title,stock,images,"rawXmlData",category,"xmlPrice" from app."Product" where "xmlSourceId"=$1`,[srcId])).rows;
  ok("every feed product imported unchanged (no import-time filtering)",prods.length===log.created&&prods.length>0,"products="+prods.length);
  ok("raw copy untouched",prods.every(p=>JSON.parse(p.rawXmlData).title===p.title));
  const other=await b("POST",`/xml-sources/${srcId}/sync`); ok("other tenant cannot sync my source",other.s===404);

  // connection + mapping + pricing + readiness
  const conn=(await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s',now()) returning id`,[store.id])).rows[0].id;
  const cats=[...new Set(prods.map(p=>p.category))];
  await c.query(`insert into app."CategoryMapping"(id,"connectionId","xmlSourceId","localCategory","marketplaceCategoryId","marketplaceCategoryName") values(gen_random_uuid(),$1,$2,$3,'411','x')`,[conn,srcId,cats[0]]);
  const url=`/marketplace/connections/${conn}/product-list`;
  let l=await a("GET",url+"?limit=50"); ok("list works; no price rule => nothing ready",l.s===200&&l.d.stats.ready===0&&l.d.stats.byIssue.no_price_rule===prods.length);
  ok("other tenant gets 404 on list",(await b("GET",url)).s===404);
  const tpl={name:"e2e",type:"percentage",value:30,applyTo:"price_template",conditions:{connectionId:conn,shippingCost:10,commissionPct:10,vatRate:null,roundingMode:"ending",roundingEnding:0.9}};
  ok("create template",(await a("POST","/pricing",tpl)).s===201);
  ok("foreign connection rejected",(await a("POST","/pricing",{...tpl,conditions:{connectionId:"00000000-0000-0000-0000-000000000000"}})).s===400);
  ok("B cannot see/modify A rules",(await b("PUT","/pricing/"+(await a("GET","/pricing")).d[0].id,{name:"hack"})).s===404);
  const calc=await a("POST","/pricing/calculate",{purchasePrice:100,value:30,conditions:{...tpl.conditions,vatRate:20}}); ok("calculator",calc.s===200&&String(calc.d.price).endsWith(".9"),JSON.stringify(calc.d.price));
  l=await a("GET",url+"?limit=50&fresh=1");
  ok("every product has server-side price",l.d.products.every(p=>p.salePrice>0),"e.g. alış "+l.d.products[0].xmlPrice+" → "+l.d.products[0].salePrice);
  const exp=Math.ceil(((l.d.products[0].xmlPrice+10)+l.d.products[0].xmlPrice*0.3)/0.9*1.2-1e-9);
  ok("VAT taken from product (20%) and .90 ending",Math.floor(l.d.products[0].salePrice)>=exp-1&&String(l.d.products[0].salePrice).endsWith(".9"));
  const withMap=prods.filter(p=>p.category===cats[0]).length;
  ok("unmapped categories flagged",l.d.stats.byIssue.no_category_mapping===prods.length-withMap);
  const rdy=await a("GET",url+"?readiness=ready&limit=5&fresh=1"); ok("ready filter server-side",rdy.d.pagination.total===l.d.stats.ready,"ready="+l.d.stats.ready);
  const blk=await a("GET",url+"?readiness=blocked&issue=no_category_mapping&limit=5&fresh=1"); ok("issue filter",blk.d.pagination.total===l.d.stats.byIssue.no_category_mapping);
  // send settings (per connection): validated, tenant-isolated, applied by the readiness check
  const ss=`/marketplace/connections/${conn}/send-settings`;
  ok("B cannot read/write A's send settings",(await b("GET",ss)).s===404&&(await b("PUT",ss,{settings:{minStock:1}})).s===404);
  ok("defaults come back normalised",(await a("GET",ss)).d?.settings?.titleCase==="none");
  const prices=prods.map(p=>p.xmlPrice).sort((x,y)=>x-y); const cut=prices[Math.floor(prices.length/2)];
  const inside=prods.filter(p=>p.xmlPrice>=cut).length;
  const put=await a("PUT",ss,{settings:{minPurchasePrice:cut,titlePrefix:"[T] ",titleCase:"upper",maxStock:5,maxImages:2,defaultBrandName:"Markasiz"}});
  ok("save send settings",put.s===200&&put.d.settings.minPurchasePrice===cut&&put.d.settings.maxStock===5);
  const bad=await a("PUT",ss,{settings:{titleCase:"<script>",maxStock:"abc",includeCategories:"x,y"}});
  ok("garbage is normalised, not stored raw",bad.s===200&&bad.d.settings.titleCase==="none"&&bad.d.settings.maxStock===null&&bad.d.settings.includeCategories.length===2);
  await a("PUT",ss,{settings:put.d.settings});
  l=await a("GET",url+"?limit=50&fresh=1");
  ok("products below the purchase price floor are blocked by send settings",l.d.stats.byIssue.excluded_by_settings===prods.length-inside,"blocked="+l.d.stats.byIssue.excluded_by_settings+" expected="+(prods.length-inside));
  ok("stored products are NOT changed by send settings",(await c.query(`select count(*)::int n from app."Product" where "xmlSourceId"=$1 and title like '[T] %'`,[srcId])).rows[0].n===0);

  // send route refuses blocked products
  const blockedId=(await a("GET",url+"?readiness=blocked&limit=1&fresh=1")).d.products[0].id;
  const sendBlocked=await a("POST",`/marketplace/connections/${conn}/send-products`,{productIds:[blockedId]});
  ok("send-products refuses a blocked product (never reaches Trendyol)",sendBlocked.s>=400||sendBlocked.d?.errors?.length>0||sendBlocked.d?.sent===0,JSON.stringify(sendBlocked.d).slice(0,110));
  // rejected product stays blocked until edited
  const t0=rdy.d.products[0];
  if(t0){
   await c.query(`insert into app."MarketplaceProduct"(id,"productId","connectionId",status,"errorMessage","updatedAt") values(gen_random_uuid(),$1,$2,'rejected','Marka geçersiz',now())`,[t0.id,conn]);
   let g=(await a("GET",url+"?fresh=1&limit=100")).d.products.find(p=>p.id===t0.id); ok("rejected product blocked",g&&g.issues.some(i=>i.code==="rejected_by_marketplace"));
   await c.query(`update app."Product" set title=title||' x', "updatedAt"=now()+interval '1 minute' where id=$1`,[t0.id]);
   g=(await a("GET",url+"?fresh=1&limit=100")).d.products.find(p=>p.id===t0.id); ok("edited product sendable again",g&&!g.issues.some(i=>i.code==="rejected_by_marketplace"));
  }
 }catch(e){console.log("ERROR",e);fails++}
 finally{
  for(const u of [A,B]){ await c.query(`delete from app."SyncLog" where "storeId"=$1`,[u.user.stores[0].id]).catch(()=>{}); await c.query(`delete from app."User" where id=$1`,[u.user.id]).catch(e=>console.log("cleanup:",e.message)); }
  console.log("leftover temp users:",(await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
  await c.end(); console.log(fails?`\n${fails} FAILED`:"\nALL PASSED"); process.exit(fails?1:0);
 }
})();
