import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},test:{environment:'node',
  include:['src/industrial-operations/*.test.ts','src/acquisition/schedule.test.ts','src/acquisition/industrial-review.test.ts','src/data-os/local-intake.test.ts','src/domain/admission.test.ts','src/db/admitRecords.test.ts'],
  pool:'forks',poolOptions:{forks:{singleFork:true}},testTimeout:30000,hookTimeout:30000}});
