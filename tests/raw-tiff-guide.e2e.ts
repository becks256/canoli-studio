import{test,expect}from'@playwright/test';
test('native RAW TIFF guide is navigable without JavaScript and discloses source precision and import limits at 390 px',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,javaScriptEnabled:false,viewport:{width:390,height:844}}),page=await context.newPage();
 try{await page.goto('/developer/api.html');await page.locator('a[href="raw-tiff.html"]').first().click();await expect(page.getByRole('heading',{level:1,name:'Native RAW master TIFF delivery',exact:true})).toBeVisible();await expect(page.locator('body')).toContainText('float TIFF input remains explicitly unsupported');await expect(page.locator('body')).toContainText('sRGB8 renderer');expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);await page.screenshot({path:info.outputPath('raw-tiff-guide-390.png'),fullPage:true});}finally{await context.close();}
});
