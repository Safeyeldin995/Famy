import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const out='qa/artifacts/issue145';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},locale:'ar-EG',timezoneId:'Africa/Cairo'});
await context.addCookies([{name:'famio_lang',value:'ar',url:'http://127.0.0.1:4145'}]);
const pages=['/preview/pro','/preview/pro/bookings','/preview/pro/booking/booking-pro-pending-1','/preview/pro/earnings','/preview/pro/notifications'];
const results=[];
for(const [i,path] of pages.entries()) {
 const page=await context.newPage(); const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 const response=await page.goto('http://127.0.0.1:4145'+path,{waitUntil:'networkidle'});
 await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:`${out}/${i}.png`,fullPage:true});
 const metrics=await page.evaluate(()=>({height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth,lang:document.documentElement.lang,dir:document.documentElement.dir,heading:document.querySelector('h1')?.textContent,closedDetails:[...document.querySelectorAll('details')].every(e=>!e.open)}));
 const result={path,status:response.status(),...metrics,errors};
 if(path.includes('/booking/')){
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  result.dock=await page.evaluate(()=>{
   const dock=document.querySelector('[data-testid="booking-action-dock"]'); const nav=document.querySelector('nav.pro-surface');
   const support=[...document.querySelectorAll('main button')].find(b=>b.textContent.includes('الدعم'));
   return {dockTop:dock?.getBoundingClientRect().top,dockBottom:dock?.getBoundingClientRect().bottom,navTop:nav?.getBoundingClientRect().top,supportBottom:support?.getBoundingClientRect().bottom,acceptPosition:document.querySelector('.apply-bottom')&&getComputedStyle(document.querySelector('.apply-bottom')).position,phoneHeight:document.querySelector('a[href^="tel:"]')?.getBoundingClientRect().height};
  });
  await page.screenshot({path:`${out}/detail-bottom.png`,fullPage:false});
 }
 results.push(result); await page.close();
}
writeFileSync(`${out}/metrics.json`,JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
await browser.close();
