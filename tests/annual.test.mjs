import test from 'node:test';
import assert from 'node:assert/strict';
import {generateSalaries,summary} from '../src/domain.js';
test('年度标准从六月回填、未来月份不预记、第二年按升年级标准、零元标准可记账',()=>{
 const p={id:'s',role:'student',degree:'master',grade:2,start_year:2026,end_year:2027};
 let d={profiles:[p],entries:[],salaryRules:[{year:2026,rates:{master_2:100000}},{year:2027,rates:{master_3:120000}}]};
 d=generateSalaries(d,'2026-08-01');
 assert.deepEqual(d.entries.map(e=>e.date),['2026-06-01','2026-07-01','2026-08-01']);
 assert.equal(summary(d.entries).expense,300000);assert.equal(summary(d.entries).income,0);
 const ids=d.entries.map(e=>e.id);d=generateSalaries(d,'2026-08-01');assert.deepEqual(d.entries.map(e=>e.id),ids);
 d=generateSalaries(d,'2027-01-01');assert.equal(d.entries.length,8);assert.equal(d.entries.at(-1).amount,120000);
 d.salaryRules[0].rates.master_2=0;d=generateSalaries(d,'2027-01-01');assert(d.entries.filter(e=>e.date.startsWith('2026')).every(e=>e.amount===0));
 assert.equal(summary(d.entries).expense,120000);
});
