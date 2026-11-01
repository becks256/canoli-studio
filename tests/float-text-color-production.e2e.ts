import {test,expect} from '@playwright/test';
test.use({javaScriptEnabled:false,viewport:{width:390,height:844}});
test('float text groundwork guide keeps implementation and remaining native text work explicit without JavaScript',async({page})=>{
 await page.goto('/developer/float-text.html');await expect(page.getByRole('heading',{name:'Native float text — implementation in progress',exact:true})).toBeVisible();await expect(page.locator('main')).toContainText('Float documents still reject text');await expect(page.locator('main')).toContainText('source-owned native paint plan');await expect(page.locator('main')).toContainText('No native glyph or float TextLayer acceptance is claimed here');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
