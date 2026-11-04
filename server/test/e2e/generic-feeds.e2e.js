// End-to-end test against a RUNNING deployment. It creates temporary users/stores and removes them afterwards.
//   E2E_DB_URL=postgresql://...:5432/postgres  [API_URL=https://api.modulpos.com/api]  node test/e2e/<file>
// Needs the "pg" dev dependency. Do not run against a database whose "app" schema holds data you cannot afford to touch.
const {Client}=require("pg"); const API=process.env.API_URL||"https://api.modulpos.com/api";
const base="https://raw.githubusercontent.com/evinso/modulpos/main/server/test/fixtures/";
(async()=>{
 const c=new Client({connectionString:process.env.E2E_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
 let fails=0; const ok=(n,cnd,x)=>{console.log((cnd?"PASS":"FAIL")+"  "+n+(x?"  → "+x:""));if(!cnd)fails++};
 const reg=await fetch(API+"/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:`tmp-gen-${Date.now()}@example.invalid`,password:"Passw0rd!test",name:"Gen"})}).then(r=>r.json());
 const call=async(m,u,b)=>{const r=await fetch(API+u,{method:m,headers:{"Content-Type":"application/json",Authorization:"Bearer "+reg.token},body:b?JSON.stringify(b):undefined});let d;try{d=await r.json()}catch{};return {s:r.status,d}};
 const storeId=reg.user.stores[0].id;
 try{
  const expect={ "feed-google.xml":{n:3,price:1874.7,cat:"Giyim|Kadın|Elbise",img:2}, "feed-turkish.xml":{n:3,price:1874.7,cat:"Ev & Yaşam|Mutfak|Kupa",img:2}, "feed-english.xml":{n:2,price:1874.7,cat:"Computers|Accessories|Mice",img:2} };
  for(const [f,e] of Object.entries(expect)){
   const an=await call("POST","/xml-sources/analyze",{url:base+f});
   ok(f+": analyze suggests a complete mapping",an.d.success&&["sku","title","price","stock","category","images"].every(k=>an.d.suggestedMapping[k]),Object.keys(an.d.suggestedMapping||{}).join(","));
   // add WITHOUT sending any mapping: the wizard sends the suggestion, but sync must also cope on its own
   const add=await call("POST","/xml-sources",{name:f,url:base+f,syncIntervalMin:60,defaultVatRate:20});
   await call("POST",`/xml-sources/${add.d.id}/sync`);
   let last; for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,1500));last=(await call("GET",`/xml-sources/${add.d.id}/sync-status`)).d;if(!last.running&&last.last.status!=="started")break}
   const rows=(await c.query(`select sku,title,"xmlPrice",stock,category,brand,images from app."Product" where "xmlSourceId"=$1 order by sku`,[add.d.id])).rows;
   ok(f+": sync created all products with no mapping",last.last.status==="completed"&&rows.length===e.n,`${rows.length}/${e.n}`);
   ok(f+": price format parsed (1874.7)",Math.abs(rows[0].xmlPrice-e.price)<0.01,String(rows[0].xmlPrice));
   ok(f+": category normalised to a path",rows[0].category===e.cat,rows[0].category);
   ok(f+": multiple images collected",JSON.parse(rows[0].images).length===e.img);
   ok(f+": no NaN/negative stock",rows.every(r=>Number.isInteger(r.stock)&&r.stock>=0),rows.map(r=>r.stock).join(","));
  }
  // generic readiness works across feeds: map one category from each feed and price them with one template
  const conn=(await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s',now()) returning id`,[storeId])).rows[0].id;
  await call("POST","/pricing",{name:"all feeds",type:"percentage",value:25,applyTo:"price_template",conditions:{connectionId:conn,commissionPct:12,shippingCost:15,vatRate:null,roundingMode:"ending",roundingEnding:0.9}});
  for(const cat of ["Giyim|Kadın|Elbise","Ev & Yaşam|Mutfak|Kupa","Computers|Accessories|Mice"]) await c.query(`insert into app."CategoryMapping"(id,"connectionId","localCategory","marketplaceCategoryId","marketplaceCategoryName") values(gen_random_uuid(),$1,$2,'1','x')`,[conn,cat]);
  const list=await call("GET",`/marketplace/connections/${conn}/product-list?limit=50&fresh=1`);
  ok("one template prices products from all three feeds",list.d.products.every(p=>p.salePrice>0),list.d.products.map(p=>p.salePrice).join(", "));
  const names=Object.fromEntries(list.d.products.map(p=>[p.sku,p]));
  ok("mapped-category products from different feeds are evaluated together",["GM-001","TR-100","EN-1"].every(k=>names[k]),"ready: "+list.d.products.filter(p=>p.ready).map(p=>p.sku).join(","));
  const issuesOf=(k)=>names[k]?names[k].issues.map(i=>i.code).join("|")||"-":"?";
  console.log("   issues:", {"GM-002 (no mapping)":issuesOf("GM-002"),"TR-101 (no barcode/desc/brand)":issuesOf("TR-101"),"TR-102 (no image)":issuesOf("TR-102")});
  ok("missing image/description/barcode are caught",names["TR-102"].issues.some(i=>i.code==="no_image")&&names["TR-101"].issues.some(i=>i.code==="no_description"));
 }catch(e){console.log("ERROR",e);fails++}
 finally{
  await c.query(`delete from app."SyncLog" where "storeId"=$1`,[storeId]).catch(()=>{}); await c.query(`delete from app."User" where id=$1`,[reg.user.id]).catch(e=>console.log("cleanup:",e.message));
  console.log("leftover temp users:",(await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
  await c.end(); console.log(fails?`\n${fails} FAILED`:"\nALL PASSED"); process.exit(fails?1:0);
 }
})();
