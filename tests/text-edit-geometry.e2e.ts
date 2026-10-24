import {test} from '@playwright/test';
import {textGeometryWorkflow} from './helpers/text-edit-geometry';
test('ordinary text edits preserve imported authored frames, native pixels and exact undo while explicit reflow remains available',async({page},info)=>{await textGeometryWorkflow(page,info);});
