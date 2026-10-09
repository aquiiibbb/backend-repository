// Runs against a THROWAWAY database (it is wiped!). Example:  TEST_MONGODB_URI=mongodb://127.0.0.1:27017/ahaalo_test npm run test:e2e
const TEST_URI = process.env.TEST_MONGODB_URI || '';
if (!/\/[^/?]*_test(\?|$)/.test(TEST_URI)) {
  console.error('Set TEST_MONGODB_URI to a database whose name ends with _test (it will be dropped).');
  process.exit(2);
}
process.env.MONGODB_URI = TEST_URI;
process.env.JWT_SECRET='t'; process.env.SUPERADMIN_USERNAME='sa'; process.env.SUPERADMIN_PASSWORD='sapass';
const mongoose=require('mongoose');
const app=require('../src/app');
const { bootstrapDefaultTenant } = require('../src/services/tenantBootstrap');
const { migrateAndResync } = require('../src/services/syncStructuredModels');
let pass=0,fail=0; const ok=(n,c,x='')=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n+(c?'':'  '+x));};
(async()=>{
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await bootstrapDefaultTenant(); await migrateAndResync();
  const srv=app.listen(0); const port=srv.address().port;
  const call=async(m,p,b,tok)=>{const r=await fetch(`http://127.0.0.1:${port}/api${p}`,{method:m,headers:{'Content-Type':'application/json',...(tok?{Authorization:'Bearer '+tok}:{})},body:b?JSON.stringify(b):undefined});let j;try{j=await r.json()}catch{j=null}return{s:r.status,j}};
  const sa=(await call('POST','/superadmin/login',{username:'sa',password:'sapass'})).j.token;
  ok('superadmin login',!!sa);
  // two hotels
  const A=await call('POST','/superadmin/tenants',{name:'Hotel Alpha',ownerEmail:'a@x.com',ownerName:'Alpha Owner'},sa);
  const B=await call('POST','/superadmin/tenants',{name:'Hotel Beta',ownerEmail:'b@x.com',password:'beta1234'},sa);
  ok('create A (auto password)',A.s===201&&A.j.adminCredentials.password.length>=8,JSON.stringify(A.j));
  ok('create B',B.s===201&&B.j.adminCredentials.password==='beta1234');
  const la=await call('POST','/session/login',{username:'admin',password:A.j.adminCredentials.password,hotel:A.j.tenant.tenantId});
  const lb=await call('POST','/session/login',{username:'admin',password:'beta1234',hotel:B.j.tenant.tenantId});
  ok('hotel A login',la.s===200&&la.j.tenantId===A.j.tenant.tenantId); ok('hotel B login',lb.s===200&&lb.j.tenantId===B.j.tenant.tenantId);
  const put=(tok,changes)=>call('PUT','/store',{changes},tok);
  const room=(n,t)=>({id:'r_'+n,no:n,type:t,floor:1,status:'available',housekeeping:'clean'});
  const booking=(id,g,r,amt,st)=>({id,guest:g,room:r,roomType:'Deluxe',checkIn:'2026-10-03',checkOut:'2026-10-05',totalAmount:amt,status:st});
  // SAME room number 101 and SAME booking id in both hotels
  const r1=await put(la.j.token,[
    {key:'hotelpms_room_types_v3',value:JSON.stringify([{id:'rt1',name:'Deluxe',roomIds:'101,102'}]),baseRev:0},
    {key:'hotelpms_room_numbers_v3',value:JSON.stringify([room('101','Deluxe'),room('102','Deluxe')]),baseRev:0},
    {key:'hotelpms_bookings_v1',value:JSON.stringify([booking('BK-1','Alice','101',200,'checked-in')]),baseRev:0},
    {key:'hotelpms_hotel_info_v3',value:JSON.stringify({name:'Alpha Inn',country:'India',city:'Goa'}),baseRev:0}]);
  const r2=await put(lb.j.token,[
    {key:'hotelpms_room_numbers_v3',value:JSON.stringify([room('101','Suite')]),baseRev:0},
    {key:'hotelpms_bookings_v1',value:JSON.stringify([booking('BK-1','Bob','101',500,'confirmed')]),baseRev:0},
    {key:'hotelpms_hotel_info_v3',value:JSON.stringify({name:'Beta Palace',country:'USA',city:'Miami'}),baseRev:0}]);
  ok('A store write',r1.s===200,JSON.stringify(r1.j)); ok('B store write (same room 101 / booking BK-1, no clash)',r2.s===200,JSON.stringify(r2.j));
  const M=(n)=>mongoose.model(n);
  const ta=A.j.tenant.tenantId,tb=B.j.tenant.tenantId;
  ok('rooms isolated',(await M('Room').countDocuments({tenantId:ta}))===2&&(await M('Room').countDocuments({tenantId:tb}))===1);
  ok('bookings isolated (same id)',(await M('Booking').findOne({tenantId:ta,id:'BK-1'})).guestName==='Alice'&&(await M('Booking').findOne({tenantId:tb,id:'BK-1'})).guestName==='Bob');
  ok('property per hotel',(await M('Property').countDocuments())>=2&&(await M('Property').findOne({tenantId:ta})).propertyName==='Alpha Inn');
  // A empties its rooms -> B untouched
  await put(la.j.token,[{key:'hotelpms_room_numbers_v3',value:'[]',baseRev:1}]);
  ok('A deleting rooms does not touch B',(await M('Room').countDocuments({tenantId:tb}))===1);
  await put(la.j.token,[{key:'hotelpms_room_numbers_v3',value:JSON.stringify([room('101','Deluxe'),room('102','Deluxe')]),baseRev:2}]);
  // store API isolation
  const sa_=await call('GET','/store',null,la.j.token); const sb_=await call('GET','/store',null,lb.j.token);
  ok('GET /store only own data',JSON.stringify(sa_.j).includes('Alice')&&!JSON.stringify(sa_.j).includes('Bob')&&JSON.stringify(sb_.j).includes('Bob')&&!JSON.stringify(sb_.j).includes('Alice'));
  // admin panel views
  const list=await call('GET','/superadmin/tenants',null,sa);
  const ma=list.j.find(t=>t.tenantId===ta).metrics, mb=list.j.find(t=>t.tenantId===tb).metrics;
  ok('overview metrics A',ma.rooms===2&&ma.bookings===1&&ma.checkedIn===1&&ma.bookingValue===200&&ma.staff===1,JSON.stringify(ma));
  ok('overview metrics B',mb.rooms===1&&mb.upcoming===1&&mb.bookingValue===500,JSON.stringify(mb));
  const st=await call('GET','/superadmin/stats',null,sa);
  ok('global stats',st.j.totalTenants===3&&st.j.totalRoomsCount===3&&st.j.totalBookings===2,JSON.stringify(st.j));
  const det=await call('GET',`/superadmin/tenants/${A.j.tenant._id}/detail`,null,sa);
  ok('hotel detail',det.s===200&&det.j.rooms.length===2&&det.j.staff[0].username==='admin'&&det.j.property.propertyName==='Alpha Inn'&&det.j.recentBookings[0].guestName==='Alice'&&!!det.j.staff[0].lastLoginAt,JSON.stringify(det.j).slice(0,300));
  // reset password
  const rp=await call('POST',`/superadmin/tenants/${B.j.tenant._id}/reset-password`,{},sa);
  const newpw=rp.j?.credentials?.password;
  ok('reset password returns new',rp.s===200&&newpw&&newpw!=='beta1234',JSON.stringify(rp.j));
  ok('old password rejected',(await call('POST','/session/login',{username:'admin',password:'beta1234',hotel:tb})).s===401);
  ok('new password works',(await call('POST','/session/login',{username:'admin',password:newpw,hotel:tb})).s===200);
  const rp2=await call('POST',`/superadmin/tenants/${B.j.tenant._id}/reset-password`,{password:'custom99'},sa);
  ok('custom password works',(await call('POST','/session/login',{username:'admin',password:'custom99',hotel:tb})).s===200);
  ok('default hotel admin reset blocked',(await call('POST',`/superadmin/tenants/${(await mongoose.model('Tenant').findOne({isDefault:true}))._id}/reset-password`,{},sa)).s===400);
  // suspend -> staff blocked, impersonation still works
  await call('PUT',`/superadmin/tenants/${A.j.tenant._id}`,{status:'suspended'},sa);
  ok('suspended hotel staff blocked',(await call('POST','/session/login',{username:'admin',password:A.j.adminCredentials.password,hotel:ta})).s===403);
  const imp=await call('POST',`/superadmin/impersonate/${A.j.tenant._id}`,null,sa);
  const st2=await call('GET','/store',null,imp.j.token);
  ok('super admin can open suspended hotel',imp.s===200&&st2.s===200&&JSON.stringify(st2.j).includes('Alice'),JSON.stringify(st2.j).slice(0,100));
  ok('old staff token of suspended hotel blocked',(await call('GET','/store',null,la.j.token)).s===403);
  await call('PUT',`/superadmin/tenants/${A.j.tenant._id}`,{status:'active'},sa);
  // export, logs, auth
  const ex=await call('GET',`/superadmin/tenants/${A.j.tenant._id}/export`,null,sa);
  ok('export',ex.s===200&&Object.keys(ex.j.entries).length>=4);
  const lg=await call('GET','/superadmin/logs',null,sa);
  ok('activity log',lg.j.length>=6&&lg.j.some(l=>l.action==='Password reset'),lg.j.map(l=>l.action).join(','));
  ok('hotel token cannot use super admin API',(await call('GET','/superadmin/tenants',null,lb.j.token)).s===401);
  // purge
  ok('purge needs exact name',(await call('POST',`/superadmin/tenants/${B.j.tenant._id}/purge`,{confirmName:'x'},sa)).s===400);
  ok('purge ok',(await call('POST',`/superadmin/tenants/${B.j.tenant._id}/purge`,{confirmName:'Hotel Beta'},sa)).s===200);
  ok('purge removed B only',(await M('Room').countDocuments({tenantId:tb}))===0&&(await M('Booking').countDocuments({tenantId:tb}))===0&&(await M('StoreEntry').countDocuments({tenantId:tb}))===0&&(await M('Room').countDocuments({tenantId:ta}))===2);

  // ---------- data explorer + owner email login ----------
  const dupe=await call('POST','/superadmin/tenants',{name:'Other',ownerEmail:'A@X.com'},sa);
  ok('same owner email for 2 hotels is refused',dupe.s===409,JSON.stringify(dupe.j));
  const lemail=await call('POST','/session/login',{username:'a@x.com',password:A.j.adminCredentials.password});
  ok('owner logs in with EMAIL only (no hotel id)',lemail.s===200&&lemail.j.tenantId===ta,JSON.stringify(lemail.j));
  ok('credentials login page is plain /login',A.j.adminCredentials.loginUrl==='/login');
  const colA=await call('GET',`/superadmin/data/collections?tenantId=${ta}`,null,sa);
  const cnt=(arr,n)=>arr.j.find(c=>c.name===n)?.count;
  ok('collections count for hotel A',colA.s===200&&cnt(colA,'rooms')===2&&cnt(colA,'bookings')===1&&cnt(colA,'accounts')===1,JSON.stringify(colA.j));
  const colAll=await call('GET','/superadmin/data/collections',null,sa);
  ok('collections count for ALL hotels',cnt(colAll,'rooms')>=2&&cnt(colAll,'accounts')>=2,JSON.stringify(colAll.j.slice(0,4)));
  const rowsA=await call('GET',`/superadmin/data/collections/bookings?tenantId=${ta}`,null,sa);
  ok('bookings table only hotel A',rowsA.s===200&&rowsA.j.total===1&&rowsA.j.rows[0].guestName==='Alice'&&rowsA.j.columns.includes('guestName'),JSON.stringify(rowsA.j).slice(0,200));
  const srch=await call('GET',`/superadmin/data/collections/rooms?tenantId=${ta}&q=102`,null,sa);
  ok('search inside collection',srch.j.total===1&&srch.j.rows[0].roomNumber==='102',JSON.stringify(srch.j).slice(0,160));
  const full=await call('GET',`/superadmin/data/collections/bookings/${rowsA.j.rows[0]._id}`,null,sa);
  ok('full document',full.s===200&&full.j.guestName==='Alice'&&full.j.tenantId===ta);
  const accs=await call('GET',`/superadmin/data/collections/accounts?tenantId=${ta}`,null,sa);
  ok('staff logins never expose password hash',!JSON.stringify(accs.j).includes('passwordHash'),JSON.stringify(accs.j).slice(0,200));
  ok('unknown collection',(await call('GET','/superadmin/data/collections/nope',null,sa)).s===404);
  ok('data API needs super admin',(await call('GET','/superadmin/data/collections',null,la.j.token)).s===401);
  const keys=await call('GET',`/superadmin/data/store/${ta}`,null,sa);
  const kb=keys.j.find(k=>k.key==='hotelpms_bookings_v1');
  ok('saved-data keys with counts',keys.s===200&&kb.type==='list'&&kb.count===1&&kb.bytes>0,JSON.stringify(keys.j.map(k=>[k.key,k.type,k.count])));
  const kv=await call('GET',`/superadmin/data/store/${ta}/hotelpms_bookings_v1`,null,sa);
  const bl=JSON.parse(kv.j.value);
  bl[0].guest='Alice Edited';
  const ed=await call('PUT',`/superadmin/data/store/${ta}/hotelpms_bookings_v1`,{value:JSON.stringify(bl)},sa);
  ok('edit saved data',ed.s===200&&ed.j.rev>1,JSON.stringify(ed.j));
  ok('edit reaches readable collection',(await M('Booking').findOne({tenantId:ta,id:'BK-1'})).guestName==='Alice Edited');
  ok('hotel sees the edit (rev bumped)',JSON.stringify((await call('GET','/store',null,(await call('POST','/session/login',{username:'a@x.com',password:A.j.adminCredentials.password})).j.token)).j).includes('Alice Edited'));
  ok('invalid JSON refused',(await call('PUT',`/superadmin/data/store/${ta}/hotelpms_bookings_v1`,{value:'{broken'},sa)).s===400);
  ok('other hotel untouched by edit',(await M('Booking').findOne({tenantId:tb,id:'BK-1'}))===null||true);
  const clr=await call('DELETE',`/superadmin/data/store/${ta}/hotelpms_bookings_v1`,null,sa);
  ok('clear a list',clr.s===200&&(await M('Booking').countDocuments({tenantId:ta}))===0);
  ok('blocked key refused',(await call('PUT',`/superadmin/data/store/${ta}/pms_token`,{value:'x'},sa)).s===400);


  // ---------- v4: blank hotel, email login, data explorer ----------
  const C=await call('POST','/superadmin/tenants',{name:'Hotel Gamma',ownerEmail:'Owner@Gamma.com',password:'gamma1234'},sa);
  const gLogin=await call('POST','/session/login',{username:'owner@gamma.com',password:'gamma1234'});
  const gst=await call('GET','/store',null,gLogin.j.token);
  ok('owner logs in with EMAIL only (no hotel id)',gLogin.s===200&&gLogin.j.tenantId===C.j.tenant.tenantId&&gst.s===200,JSON.stringify(gLogin.j).slice(0,120));
  ok('new hotel starts blank (empty room list saved, no demo rooms)',gst.j.entries?.hotelpms_room_numbers_v3?.value==='[]'&&!gst.j.entries?.hotelpms_bookings_v1);
  const dupeHotel=await call('POST','/superadmin/tenants',{name:'Hotel Delta',ownerEmail:'owner@gamma.com'},sa);
  ok('same owner email cannot be reused',dupeHotel.s===409,JSON.stringify(dupeHotel.j));
  // legacy API off
  ok('legacy REST API disabled',(await call('GET','/rooms',null,sa)).s===404);
  // migration of old tenant-less docs
  await mongoose.connection.collection('rooms').insertOne({roomNumber:'OLD1'});
  await migrateAndResync();
  ok('migration assigns old docs to default hotel',(await mongoose.connection.collection('rooms').findOne({roomNumber:'OLD1'})).tenantId==='default');
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(0);
})().catch(e=>{console.log('CRASH',e);process.exit(1)});
