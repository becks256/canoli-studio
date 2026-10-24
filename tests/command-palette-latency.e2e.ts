import {test} from '@playwright/test';
import {paletteLatencyWorkflow} from './helpers/palette-latency';
for(const count of [0,16,64])test(`palette presentation and readonly search on ${count} vector layers`,async({page},info)=>{test.setTimeout(240000);await paletteLatencyWorkflow(page,info,count);});
