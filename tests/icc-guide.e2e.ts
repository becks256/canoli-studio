import {test,expect}from '@playwright/test';
test('ICC guide remains readable without JavaScript and separates RGB workflow from remaining precision gates',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,javaScriptEnabled:false,viewport:{width:390,height:844}}),page=await context.newPage();
 try{
  await page.goto('/developer/api.html');await page.locator('a[href="icc-engine.html"]').first().click();await expect(page.getByRole('heading',{level:1,name:'Native ICC engine dependency',exact:true})).toBeVisible();
  await expect(page.locator('body')).toContainText('connects to trusted browser color settings');await expect(page.locator('body')).toContainText('scene still composites sRGB8');await expect(page.locator('body')).toContainText('The original failure is not hidden by a larger threshold');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);expect(overflow).toBeLessThanOrEqual(1);await page.screenshot({path:info.outputPath('icc-dependency-guide.png'),fullPage:true});
 }finally{await context.close();}
});
