const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const PORT=Number(process.env.PORT||3000);
const HOST='0.0.0.0';
const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data');
fs.mkdirSync(DATA_DIR,{recursive:true});
const DATA=path.join(DATA_DIR,'data.json');
const ADMIN_PASSWORD=String(process.env.ADMIN_PASSWORD||'');
if(!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD no está configurada: el acceso administrativo permanecerá deshabilitado.');
const ADMIN_NAMES=new Set(['hwang hyunjin','hwang yeji']);
let db=fs.existsSync(DATA)?JSON.parse(fs.readFileSync(DATA,'utf8')):{players:{},territories:{north:{control:82},center:{control:50},south:{control:78}},incidents:[],updatedAt:Date.now()};
db.knownPlayers=db.knownPlayers||{};
const sessions=new Map();
const presence=new Map();
const PRESENCE_TTL=90000;
function save(){db.updatedAt=Date.now();fs.writeFileSync(DATA,JSON.stringify(db,null,2));}
function norm(s){return String(s||'').trim().replace(/\s+/g,' ').toLowerCase()}
function hash(pass,salt){return crypto.scryptSync(String(pass),salt,64).toString('hex')}
function verify(pass,stored){const [salt,h]=String(stored||'').split('$');if(!salt||!h)return false;const a=Buffer.from(hash(pass,salt),'hex'),b=Buffer.from(h,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b)}
function passwordHash(pass){const salt=crypto.randomBytes(16).toString('hex');return salt+'$'+hash(pass,salt)}
function token(){return crypto.randomBytes(32).toString('hex')}
function clean(p){const {passwordHash,...safe}=p;return safe}
function profile(name,isAdmin=false){return {id:crypto.randomUUID(),name,code:'MFW-'+crypto.randomBytes(4).toString('hex').toUpperCase(),faction:null,xp:0,credits:0,reputation:0,missionsCompleted:[],unlockedFiles:[],achievements:{},decisions:[],history:[],incidents:[],events:[],submissions:[],createdAt:Date.now(),avatar:'',suspended:false,isAdmin}}
function send(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(body)}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>2e6)req.destroy()});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)})}
function auth(req){const h=req.headers.authorization||'';const t=h.startsWith('Bearer ')?h.slice(7):'';const s=sessions.get(t);if(!s)return null;const p=db.players[s.id];if(!p||p.suspended)return null;return {token:t,player:p}}
function isAdminName(name){return ADMIN_NAMES.has(norm(name))}
function requireAdmin(req){const a=auth(req);
  if(a){const ss=sessions.get(a.token);if(ss){ss.lastSeen=Date.now();presence.set(norm(a.player.code),{name:a.player.name,code:a.player.code,faction:a.player.faction,lastSeen:Date.now()})}}return a&&a.player.isAdmin&&isAdminName(a.player.name)?a:null}
function prunePresence(){const now=Date.now();for(const [k,v] of presence)if(now-v.lastSeen>PRESENCE_TTL)presence.delete(k)}
function population(){prunePresence();const known=Object.values(db.knownPlayers);const players=[...Object.values(db.players),...known.filter(k=>!db.players[norm(k.name)])].filter(p=>!p.suspended);const counts={'CORRUPTION LORDS':0,'EMPIRE SHADOWS':0,'SIN ASIGNAR':0};for(const p of players)counts[p.faction||'SIN ASIGNAR']=(counts[p.faction||'SIN ASIGNAR']||0)+1;const onlinePlayers=[...presence.values()];const online={'CORRUPTION LORDS':0,'EMPIRE SHADOWS':0,'SIN ASIGNAR':0};for(const p of onlinePlayers)online[p.faction||'SIN ASIGNAR']=(online[p.faction||'SIN ASIGNAR']||0)+1;return {total:players.length,online:onlinePlayers.length,registeredByFaction:counts,onlineByFaction:online,onlinePlayers:onlinePlayers.map(p=>({name:p.name,code:p.code,faction:p.faction||'SIN ASIGNAR',lastSeen:p.lastSeen})),updatedAt:Date.now()}}
function publicState(){return {territories:db.territories,online:population().online,updatedAt:db.updatedAt}}
async function route(req,res){
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});return res.end()}
 const u=new URL(req.url,'http://localhost');
 try{
  if(req.method==='GET'&&u.pathname==='/api/state')return send(res,200,publicState());
  if(req.method==='POST'&&u.pathname==='/api/presence'){const x=await body(req),code=String(x.code||'').trim(),name=String(x.name||'').trim(),faction=x.faction||null;if(!code||!name)return send(res,400,{error:'Presencia inválida'});presence.set(norm(code),{name,code,faction,lastSeen:Date.now()});db.knownPlayers[norm(code)]={name,code,faction,suspended:false,updatedAt:Date.now()};save();return send(res,200,{ok:true,online:population().online})}
  if(req.method==='GET'&&u.pathname==='/api/population')return send(res,200,population());
  if(req.method==='POST'&&u.pathname==='/api/register'){const x=await body(req),name=String(x.name||'').trim(),pass=String(x.pass||'');if(name.length<2||name.length>32)return send(res,400,{error:'Nombre inválido'});if(pass.length<4)return send(res,400,{error:'Contraseña demasiado corta'});const key=norm(name);if(db.players[key])return send(res,409,{error:'Ese nombre ya está registrado'});const p=profile(name,isAdminName(name));p.passwordHash=passwordHash(pass);db.players[key]=p;save();const t=token();sessions.set(t,{id:key,createdAt:Date.now(),lastSeen:Date.now()});presence.set(key,{name:p.name,code:p.code,faction:p.faction,lastSeen:Date.now()});return send(res,201,{token:t,profile:clean(p)})}
  if(req.method==='POST'&&u.pathname==='/api/login'){const x=await body(req),key=norm(x.name),p=db.players[key];if(!p||!verify(String(x.pass||''),p.passwordHash)||p.suspended)return send(res,401,{error:'Credenciales incorrectas'});const t=token();sessions.set(t,{id:key,createdAt:Date.now(),lastSeen:Date.now()});presence.set(key,{name:p.name,code:p.code,faction:p.faction,lastSeen:Date.now()});return send(res,200,{token:t,profile:clean(p)})}
  if(req.method==='POST'&&u.pathname==='/api/admin/login'){const x=await body(req),name=String(x.name||'').trim();if(!ADMIN_PASSWORD||!isAdminName(name)||String(x.pass||'')!==ADMIN_PASSWORD)return send(res,401,{error:'Acceso denegado'});const key=norm(name);if(!db.players[key]){const p=profile(name,true);p.passwordHash=passwordHash(ADMIN_PASSWORD);db.players[key]=p;save()}else db.players[key].isAdmin=true;const t=token();sessions.set(t,{id:key,createdAt:Date.now(),lastSeen:Date.now()});presence.set(key,{name:db.players[key].name,code:db.players[key].code,faction:db.players[key].faction,lastSeen:Date.now()});return send(res,200,{token:t,profile:clean(db.players[key])})}
  const a=auth(req);
  if(req.method==='GET'&&u.pathname==='/api/me'){if(!a)return send(res,401,{error:'Sesión expirada'});return send(res,200,{profile:clean(a.player),state:publicState()})}
  if(req.method==='POST'&&u.pathname==='/api/logout'){const h=req.headers.authorization||'';if(h.startsWith('Bearer '))sessions.delete(h.slice(7));return send(res,200,{ok:true})}
  if(req.method==='POST'&&u.pathname==='/api/player/sync'){if(!a)return send(res,401,{error:'Sesión expirada'});const x=await body(req),q=x.profile||{},p=a.player;for(const k of ['name','code','faction','xp','credits','reputation','missionsCompleted','unlockedFiles','achievements','decisions','history','incidents','events','submissions','createdAt','avatar'])if(k in q)p[k]=q[k];p.xp=Math.max(0,Number(p.xp)||0);p.credits=Math.max(0,Number(p.credits)||0);p.reputation=Math.max(0,Number(p.reputation)||0);save();return send(res,200,{ok:true,profile:clean(p),state:publicState()})}
  if(req.method==='GET'&&u.pathname==='/api/admin/players'){if(!requireAdmin(req))return send(res,403,{error:'Acceso denegado'});return send(res,200,{players:Object.values(db.players).map(clean),state:publicState()})}
  if(req.method==='POST'&&u.pathname==='/api/admin/player'){if(!requireAdmin(req))return send(res,403,{error:'Acceso denegado'});const x=await body(req),key=norm(x.name),p=db.players[key];if(!p)return send(res,404,{error:'Jugador no encontrado'});for(const k of ['xp','credits','reputation','faction','suspended'])if(k in x)p[k]=x[k];save();return send(res,200,{profile:clean(p)})}
  if(req.method==='POST'&&u.pathname==='/api/admin/territory'){if(!requireAdmin(req))return send(res,403,{error:'Acceso denegado'});const x=await body(req),zone=String(x.zone||''),delta=Number(x.delta)||0;if(!db.territories[zone])return send(res,400,{error:'Territorio inválido'});db.territories[zone].control=Math.max(0,Math.min(100,Number(db.territories[zone].control)+delta));save();return send(res,200,publicState())}
  return send(res,404,{error:'Ruta no encontrada'})
 }catch(e){console.error(e);return send(res,500,{error:'Error interno del servidor'})}
}
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify({ok:true,service:'THE MAFIA WAR ONLINE',time:Date.now()}))}if(u.pathname.startsWith('/api/'))return route(req,res);if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end()}let file=path.join(__dirname,'public',u.pathname==='/'?'index.html':u.pathname);const publicRoot=path.resolve(__dirname,'public');file=path.resolve(file);if(file!==publicRoot&&!file.startsWith(publicRoot+path.sep))return send(res,403,{error:'Forbidden'});if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(__dirname,'public','index.html');const ext=path.extname(file);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res)});
server.listen(PORT,HOST,()=>console.log(`THE MAFIA WAR ONLINE running on ${HOST}:${PORT}`));
process.on('SIGINT',()=>{save();process.exit()});process.on('SIGTERM',()=>{save();process.exit()});
