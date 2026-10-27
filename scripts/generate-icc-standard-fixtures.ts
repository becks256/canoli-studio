/** Explicit fixture generation only; normal builds/tests never rewrite inputs. */
import {mkdir,writeFile}from 'node:fs/promises';
import {STANDARD_PROFILES}from '../src/core/color/icc';
const directory=process.argv[2]??'tests/fixtures/icc-native';await mkdir(directory,{recursive:true});
for(const[name,profile]of Object.entries(STANDARD_PROFILES))await writeFile(`${directory}/${name}.icc`,profile.iccBytes!);
