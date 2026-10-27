import{test,expect}from'@playwright/test';
test('float TIFF guide discloses actual source, consent and precision limits without JavaScript at 390 px',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,javaScriptEnabled:false,viewport:{width:390,height:844}}),page=await context.newPage();
 try{await page.goto('/developer/api.html');await page.locator('a[href="float-tiff.html"]').first().click();await expect(page.getByRole('heading',{level:1,name:'Float TIFF input and retained precision',exact:true})).toBeVisible();await expect(page.locator('body')).toContainText('There is no silent default');await expect(page.locator('body')).toContainText('In the default byte mode,');expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);await page.screenshot({path:info.outputPath('float-tiff-guide-390.png'),fullPage:true});}finally{await context.close();}
});
