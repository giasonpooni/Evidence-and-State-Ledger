import {writeFileSync} from 'node:fs';
import {retainIndustrialCapture} from '../src/acquisition/industrial-review';
const [captureRoot,intakeRoot,output,permission,...extra] = process.argv.slice(2);
if (!captureRoot || !intakeRoot || !output || permission !== '--allow-internal-qualification' || extra.length) {
  throw new Error('Usage: industrial-review CAPTURE_DIR INTAKE_DIR OUTPUT --allow-internal-qualification');
}
const review = retainIndustrialCapture(captureRoot,intakeRoot,true);
writeFileSync(output,JSON.stringify(review,null,2),{encoding:'utf8',flag:'wx'});
console.log(JSON.stringify({schema:review.schema,bindings:review.bindings.length,integrity:review.integrity,canonicalAdmission:false,release:null}));
