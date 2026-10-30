import {test} from '@playwright/test';
import {floatSourceImportWorkflow} from './helpers/float-source-import';
test('native 50 MP float import preserves original samples, ordinary Undo and reopened viewport', async ({page}, info) => {
  test.setTimeout(600000); await floatSourceImportWorkflow(page, info);
});
