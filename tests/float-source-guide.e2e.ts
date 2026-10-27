import{test,expect}from'@playwright/test';
test('float source guide explains original ownership and budgets without JavaScript at 390 px',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,javaScriptEnabled:false,viewport:{width:390,height:844}}),page=await context.newPage();
 try{await page.goto('/developer/api.html');await page.locator('a[href="float-sources.html"]').first().click();await expect(page.getByRole('heading',{level:1,name:'Owned float originals and derived tiles',exact:true})).toBeVisible();await expect(page.locator('body')).toContainText('Original Blob bytes remain authoritative');await expect(page.locator('body')).toContainText('262,144 pixels');expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await page.screenshot({path:info.outputPath('float-source-guide-390.png'),fullPage:true});}finally{await context.close();}
});
