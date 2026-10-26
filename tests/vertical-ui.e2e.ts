import {test} from '@playwright/test';
import {verticalTextWorkflow} from './helpers/vertical-text';
test('public vertical Inspector, native script example, cancellation and project reopening',async({page},info)=>{await verticalTextWorkflow(page,info);});
