import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root=process.env.VOLTIUS_UI_EVIDENCE;
for(const name of ['tabs','chrome','gestures','glyphs']){
 const result=spawnSync(process.execPath,[`scripts/verify-mobile-${name}.mjs`],{stdio:'inherit',env:{...process.env,VOLTIUS_UI_EVIDENCE:path.join(root??'android-ui-evidence',name)}});
 if(result.status!==0)process.exit(result.status??1);
}
