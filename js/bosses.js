// Native state/action reconstruction. See docs/native-boss-evidence.md for the
// bounded ELF ranges, animation flags, and remaining simulation differences.
import { integrateAxis } from "./physics.js";

export const BOSS_KINDS = new Set([
  "TopoNinja", "BigBird", "FurryCritter", "BigUglyDragon", "GiantDragonfly",
  "BigAnguila", "BigPirana", "BigBat", "BigGhost", "BigSpider", "Malmark2",
]);
export const BOSS_MINIONS = Object.freeze({
  TopoNinja:"TopoNinjaStar", BigBird:null, FurryCritter:"FurryCritterChild",
  BigUglyDragon:null, GiantDragonfly:null, BigAnguila:"Anguila",
  BigPirana:"BigPiranaBlowFish", BigBat:"Bat", BigGhost:null,
  BigSpider:"LittleSpider", Malmark2:"Bat",
});
const FREE_FLIGHT = new Set(["BigBird","GiantDragonfly","BigGhost","BigSpider","Malmark2"]);
const POSES = {
  TopoNinja:{waiting:"stand",stand:"stand",prepareJump:"roll",jump:"roll",kick:"kick",attack:"shot"},
  FurryCritter:{seek:"moving",attack:"attack",smash:"smash"},
  BigUglyDragon:{attack:"attack"}, BigAnguila:{attack:"attack"},
  BigPirana:{waiting:"normalSkinned",normal:"normalSkinned",attack:"normal"},
  BigSpider:{attack:"shooting"}, Malmark2:{attack1:"attack1",attack2:"attack2"},
};
const sign = Math.sign;
let damageSequence=0;
function random(e) {
  let x=e.seed|0; x^=x<<13;x^=x>>>17;x^=x<<5;
  e.seed=x>>>0||0x9e3779b9;return e.seed/4294967296;
}
// Native SetTimer(base, spread) = base + randomBetween(0, spread), NOT min/max.
function timer(e,base,spread=0) { return base+random(e)*spread; }
function play(e,name,restart=false) {
  if(!e.anim?.has(name))return;
  if(restart||e.anim.cur?.name!==name){
    e.anim.set(name,{restart:true});e.motionFrame=-1;e.flags=[];
  }
  e.animName=name;e.cur=e.anim.frame;
}
function enter(e,state) {
  e.state=state;e.stateTime=0;e.fired=0;e.actionDone=false;
  play(e,POSES[e.kind]?.[state]||"normal",!(e.kind==="TopoNinja"&&state==="jump"));
  if(state==="normal"||state==="stand") {
    const times={TopoNinja:[.1,1.4],BigBird:[3,0],BigUglyDragon:[1,2],
      BigAnguila:[1,2],BigPirana:[8,2],BigGhost:[3,3],BigSpider:[1,1],Malmark2:[3,2]};
    if(times[e.kind])e.thinkT=timer(e,...times[e.kind]);
    if(e.kind==="BigGhost")e.shootT=timer(e,1,.5);
  }
  if(e.kind==="BigPirana")e.vulnerable=state==="attack";
}
function face(e,p) {if(p.x!==e.x)e.dir=sign(p.x-e.x);}
function near(e,p,d,both=false) {return Math.abs(p.x-e.x)<d&&(!both||Math.abs(p.y-e.y)<d);}
function flag(e,type) {return e.flags?.filter(ev=>ev.type===type&&ev.animation===e.anim?.cur?.name)||[];}
function count(e,api,kind) {const n=api.nearby?.(kind,e)||0;return Array.isArray(n)?n.length:n;}
function spawn(e,api,kind,dx,dy,dir=e.dir) {api.spawn?.(kind,e.x+dx*e.dir,e.y+dy,dir,e);}
function shot(e,api,options={}) {api.shoot?.(e,{offsetX:0,offsetY:-16,...options});}
function animation(e,dt,api) {
  e.anim?.update(dt);e.cur=e.anim?.frame||e.cur;
  e.flags=e.anim?.drainEvents?.()||[];
  for(const ev of e.flags)if(ev.type==="PlaySound"&&ev.frame?.snd)api.sound?.(ev.frame.snd);
}
function limits(e) {
  if(e.kind==="TopoNinja"&&["jump","kick"].includes(e.state))return [32000,1e9];
  if(e.kind==="BigUglyDragon")return [120,120];
  if(e.kind==="BigBat")return [240,120];
  if(e.kind==="BigAnguila"||e.kind==="BigPirana")return [60,60];
  if(e.kind==="BigBird")return e.state==="attack"?[240,240]:[512,60];
  if(e.kind==="BigGhost"&&e.state==="attack")return [120,120];
  return [32000,500]; // GameD::reset defaults; per-state overrides above.
}
function bounds(api,e) {return typeof api.bounds==="function"?api.bounds(e):api.bounds;}
function contain(e,api) {
  const b=bounds(api,e);if(!b)return;
  const left=b.left??b.minX??b.x??-Infinity,right=b.right??b.maxX??(b.x+b.w);
  const top=b.top??b.minY??b.y??-Infinity,bottom=b.bottom??b.maxY??(b.y+b.h);
  if(e.x<left){e.x=left;e.vx=Math.max(0,e.vx);}if(e.x>right){e.x=right;e.vx=Math.min(0,e.vx);}
  if(e.y<top){e.y=top;e.vy=Math.max(0,e.vy);}if(e.y>bottom){e.y=bottom;e.vy=Math.min(0,e.vy);}
}
function move(e,dt,api,ax=0,ay=0,gravity=0) {
  // applyD maps GameD+0x0c to horizontal FRICTION, not gravity/speed.
  const friction=e.kind==="BigGhost"?60:e.kind==="BigBird"&&e.state==="normal"?100:0;
  const [mx,my]=limits(e),x=integrateAxis(e.vx,ax,friction,mx,dt),y=integrateAxis(e.vy,ay+gravity,0,my,dt);
  e.vx=x.velocity;
  if(api.moveBody&&!FREE_FLIGHT.has(e.kind)) {
    const oldY=e.y;
    e.stepX=x.displacement;
    // Shared body integrator supplies the vertical acceleration and floor sweep.
    e.maxFall=my;api.moveBody(e,dt,ay+gravity);
    const bounce=e.kind==="BigUglyDragon"?-1:e.kind==="BigBat"?-.5:e.kind==="TopoNinja"&&e.state==="kick"?-.2:0;
    if(e.hitWall&&bounce)e.vx=x.velocity*bounce;
    if(bounce&&e.kind!=="TopoNinja"&&e.vy===0&&y.velocity!==0&&Math.abs(e.y-oldY-y.displacement)>1e-8){
      e.vy=y.velocity*bounce;e.ground=false;
    }
  } else {
    e.x+=x.displacement;e.y+=y.displacement;e.vy=y.velocity;
    if(gravity>0&&e.y>=e.homeY&&e.vy>=0&&!FREE_FLIGHT.has(e.kind)){
      e.y=e.homeY;e.vy=0;e.ground=true;
    }
  }
  // Native free-flight actors can leave the map/camera during a pass. Clamping
  // them to the map edge can prevent the 600px dragonfly retreat from EVER
  // completing in the level-9 arena, which is near the map's right edge.
  if(!FREE_FLIGHT.has(e.kind)&&e.kind!=="TopoNinja"&&e.kind!=="FurryCritter")contain(e,api);
}
// SeekObject(..., true) applies AXIS ACCELERATIONS, not normalized velocities.
function seek(e,p,dt,api,ax,ay,offsetY=0,gravity=0) {
  move(e,dt,api,sign(p.x-e.x)*ax,sign(p.y+offsetY-e.y)*ay,gravity);
}
function initial(e) {
  if(e.bossInitialized)return;
  e.bossInitialized=true;e.boss=e.isBoss=true;e.stateTime=0;e.flags=[];
  e.seed=e.seed>>>0||0x9e3779b9;e.homeX??=e.x;e.homeY??=e.y;
  e.vx??=0;e.vy??=0;e.hurtT??=0;e.invulnerableT??=0;e.spawnT=5;
  e.bossStarted=false;e.bossDefeatedSent=false;e.defeated=false;
  e.bossBarRequested=["TopoNinja","BigBat"].includes(e.kind);e.bossBarOrder=0;
  enter(e,e.fight?(e.kind==="TopoNinja"?"stand":"normal"):"waiting");
  if(e.kind==="BigBat"&&e.fight)e.vx=e.dir*100;
}
function die(e) {
  e.hp=0;e.state="dying";e.stateTime=0;e.vx=e.vy=0;e.contact=false;
  e.gravity=0;e.hurtT=0;e.invulnerableT=Infinity;e.deathBoomT=0;e.defeated=false;
  play(e,e.anim?.has("dead")?"dead":"normal",true);
}
function death(e,api) {
  const regular=Math.min(30,Math.floor(Math.min(e.stateTime,3)/.1+1e-8));
  while(e.deathBoomT<regular){e.deathBoomT++;api.explosion?.(e);}
  if(e.stateTime>=4&&!e.bossDefeatedSent){
    for(let i=0;i<5;i++)api.explosion?.(e);
    api.shake?.(.2);e.state="defeated";e.defeated=true;e.bossDefeatedSent=true;api.bossDefeated?.(e);
  }
}
export function damageBoss(e,direction=1,damage=1) {
  if(!e||!BOSS_KINDS.has(e.kind)||!e.fight||e.hp<=0||e.defeated||
    ["waiting","dying","defeated"].includes(e.state)||e.vulnerable===false||e.hurtT>0||e.invulnerableT>0)return false;
  e.hp=Math.max(0,e.hp-(Number.isFinite(damage)&&damage>0?damage:1));
  e.hurtT=.25;e.lastHitDirection=direction;
  e.bossBarRequested=true;e.bossBarOrder=++damageSequence;
  // Native ENEMY_COMMON_STATE blinks/shakes the CURRENT pose. The exported
  // "damage" images are not a living hurt animation (many look like corpses).
  if(e.hp<=0)die(e);
  return true;
}
function topo(e,p,dt,api) {
  if(e.state==="stand") {
    e.vx=0;face(e,p);move(e,dt,api,0,0,1800);
    if(e.stateTime>=e.thinkT){const r=random(e);enter(e,r<.5?"attack":r<.75?"prepareJump":"kick");}
  } else if(e.state==="prepareJump") {
    e.vx=e.vy=0;
    if(flag(e,"PhysicEvent").length){enter(e,"jump");e.vy=-960;e.ground=false;}
  } else if(e.state==="jump") {
    seek(e,p,dt,api,480,0,0,1800);
    if(e.ground&&e.stateTime>0){e.vx=0;enter(e,"stand");}
  } else if(e.state==="kick") {
    if(flag(e,"PhysicEvent").length&&!e.actionDone){
      e.actionDone=true;face(e,p);e.vy=-300;e.vx=e.dir*640;e.ground=false;
    }
    if(e.actionDone){
      move(e,dt,api,0,0,960);
      if(e.hitWall){api.shake?.(.25);e.vy=-240;}
      if(e.ground){e.vx=0;enter(e,"stand");}
    }
  } else if(e.state==="attack") {
    e.vx=0;
    for(const _ of flag(e,"Custom")){
      face(e,p);shot(e,api,{aim:true,speed:320,homingSpeed:320,targetOffsetY:-8,
        offsetX:64,offsetY:-70,library:"TopoNinja",animation:"star",endAnimation:"starDead",endLife:1,terrain:true});
      e.fired++;
    }
    if(e.anim?.finished)enter(e,"stand");
  }
}
function bird(e,p,dt,api) {
  face(e,p);
  if(e.state==="attack") {
    seek(e,p,dt,api,120,120,-16);
    if(e.stateTime>=e.actionT){enter(e,"normal");api.releaseBird?.(e);}
  } else {
    if(near(e,p,128,true))seek(e,p,dt,api,-320,600,-128);
    else {e.vy=0;move(e,dt,api);}
    if(e.stateTime>=e.thinkT&&(!api.claimBird||api.claimBird(e))){enter(e,"attack");e.actionT=timer(e,5,3);}
  }
}
function furry(e,p,dt,api) {
  if(e.state==="normal") {
    e.vx=e.vy=0;
    if(!near(e,p,256)){enter(e,"seek");}
    else if(e.stateTime>3)enter(e,random(e)<.5?"attack":"smash");
  } else if(e.state==="seek") {
    face(e,p);e.vx=0;
    if(e.anim?.i!==e.motionFrame){e.stepX=e.dir*(e.anim?.frame?.dx||0);e.motionFrame=e.anim?.i;}
    // Animation displacement, not an invented 60 px/s chase.
    if(api.moveBody)api.moveBody(e,dt,0);else {e.x+=e.stepX||0;e.stepX=undefined;}
    const boomNear=e.stateTime>1&&api.booms?.some(b=>near(e,b,32));
    if(near(e,p,160)||boomNear)enter(e,random(e)<.5?"attack":"smash");
  } else if(e.state==="attack") {
    face(e,p);e.vx=e.vy=0;
    if(!e.actionDone){e.actionDone=true;e.shootT=timer(e,1,1);}
    if(!(e.fired&1)&&e.stateTime>=e.shootT){e.fired|=1;shot(e,api,{fireball:true,offsetX:64,offsetY:-4});}
    if(e.stateTime>2.1)enter(e,"seek");
  } else if(e.state==="smash") {
    e.vx=e.vy=0;
    for(const _ of flag(e,"MakeEffect")){
      api.shake?.(.2);
      if(count(e,api,"FurryCritterChild")<=5){
        const dx=[-128,-96,-64,96,64][Math.floor(random(e)*5)];
        spawn(e,api,"FurryCritterChild",dx,-300);
      }
    }
    if(e.anim?.finished)enter(e,"seek");
  }
}
function dragon(e,p,dt,api) {
  face(e,p);
  if(e.state==="normal"&&api.inCamera?.(e)===false)e.vx=e.vy=0;
  else seek(e,p,dt,api,120,120,-96);
  if(e.state==="attack") {
    // Always action for 0.2 seconds: a short continuous flame stream.
    e.shootT=(e.shootT||0)+dt;
    while(e.shootT>=1/60-1e-9){shot(e,api,{fireball:true,offsetX:32,offsetY:-32});e.shootT-=1/60;}
    if(e.stateTime>=.2){enter(e,"normal");e.shootT=0;}
  } else if(e.stateTime>=e.thinkT){enter(e,"attack");e.shootT=0;}
}
function dragonfly(e,p,dt,api) {
  if(e.state==="normal") {
    face(e,p);
    if(near(e,p,600)){e.vx=-e.dir*320;seek(e,p,dt,api,0,1e9,-72);}
    else {enter(e,"attack");e.vx=e.dir*timer(e,-120,120);e.vy=0;}
  } else {
    // Keep the launch facing through the pass; turn only after passing the
    // player AND leaving the camera. Re-facing each tick produced oscillation.
    move(e,dt,api,e.dir*240);
    if(near(e,p,32))shot(e,api,{aim:true,offsetY:-8});
    const behind=sign(p.x-e.x)!==e.dir;
    if(behind&&api.inCamera?.(e)===false)enter(e,"normal");
    // Bounded embedders may omit a camera or clamp exactly on its edge.
    else if(behind&&bounds(api,e)&&e.vx===0)enter(e,"normal");
  }
}
function anguila(e,p,dt,api) {
  face(e,p);
  if(e.state==="normal") {
    seek(e,p,dt,api,60,60);
    if(api.waterAt&&!api.waterAt(e.x,e.y))e.vy=60;
    if(e.ground)e.vy=-60;
    if(e.stateTime>=e.thinkT){
      const choice=Math.floor(random(e)*4);
      if(choice===0){spawn(e,api,"Anguila",-16,-16);spawn(e,api,"Anguila",16,-16);}
      else if(choice===1)shot(e,api,{aim:true});
      else if(choice===2){for(const vy of [-240,240])shot(e,api,{vx:e.dir*240,vy});}
      else for(const [vx,vy]of [[-240,0],[240,0],[0,-240],[0,240]])shot(e,api,{vx,vy});
      enter(e,"attack");e.vx=e.vy=0;
    }
  } else if(e.stateTime>=1)enter(e,"normal");
}
function pirana(e,p,dt,api) {
  if(e.state==="normal") {
    face(e,p);seek(e,p,dt,api,60,60);
    if(api.waterAt&&!api.waterAt(e.x,e.y))e.vy=60;
    if(e.ground)e.vy=-60;
    if(e.stateTime>=e.thinkT){
      for(const [x,y]of [[0,-40],[30,0],[-30,0],[30,-80],[-30,-80]])spawn(e,api,"BigPiranaBlowFish",x,y);
      enter(e,"attack");e.vx=e.vy=0;
    }
  } else {
    e.vx=e.vy=0;
    if(e.stateTime>=10)enter(e,"normal");
  }
}
function bat(e,p,dt,api) {
  face(e,p);seek(e,p,dt,api,48,60,-120);
  if(e.ground)e.vy=-200;
  e.spawnT-=dt;
  if(e.spawnT<=0&&count(e,api,"Bat")<=5){spawn(e,api,"Bat",0,0);e.spawnT=5;}
}
function ghost(e,p,dt,api) {
  face(e,p);
  if(e.state==="normal") {
    const inside=api.inCamera?.(e)!==false;
    if(!inside)e.vx=e.dir*60;
    const ax=inside&&near(e,p,200)?-120:0;
    seek(e,p,dt,api,ax,240,-64);
    e.shootT-=dt;
    if(e.shootT<=0){shot(e,api,{aim:true,offsetX:8,offsetY:-32});e.shootT=timer(e,.4,.2);}
    if(e.stateTime>=e.thinkT){
      enter(e,"attack");e.actionT=timer(e,3,2);
      const dx=p.x-e.x,dy=p.y-e.y,d=Math.hypot(dx,dy)||1;e.vx=-dx/d*120;e.vy=-dy/d*120;
    }
  } else {
    seek(e,p,dt,api,320,120,-32);
    if(e.stateTime>=e.actionT)enter(e,"normal");
  }
}
function spider(e,p,dt,api) {
  if(e.state==="normal") {
    e.vx=e.vy=0;
    if(!e.actionDone){e.actionDone=true;spawn(e,api,"LittleSpider",-32,-60);spawn(e,api,"LittleSpider",32,-60,-e.dir);shot(e,api,{aim:true,offsetX:8,offsetY:-8});}
    if(e.stateTime>=e.thinkT)enter(e,"down");
  } else if(e.state==="down") {
    e.vx=0;e.vy=240;move(e,dt,api);
    if(e.y>=e.homeY+192){e.y=e.homeY+192;enter(e,"attack");e.vy=0;e.actionT=timer(e,2,1);e.shootT=timer(e,.2,.5);}
  } else if(e.state==="attack") {
    face(e,p);e.vx=e.vy=0;e.shootT-=dt;
    if(e.shootT<=0){shot(e,api,{aim:true,offsetX:8,offsetY:-8});e.shootT=timer(e,.3,.1);}
    if(e.stateTime>=e.actionT)enter(e,"up");
  } else {
    e.vx=0;e.vy=-60;move(e,dt,api);
    if(e.y<=e.homeY){e.y=e.homeY;e.vy=0;enter(e,"normal");}
  }
}
function markerList(e,api) {const m=typeof api.markers==="function"?api.markers(e):api.markers;return (m||[]).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));}
function markerPoint(m) {return {x:m.x+(m.w??m.width??(m.props?32:0))/2,y:m.y+(m.h??m.height??(m.props?32:2))-2};}
function malmark(e,p,dt,api) {
  if(e.state==="normal") {
    face(e,p);e.vx=e.vy=0;
    if(e.stateTime>=e.thinkT){
      const spots=markerList(e,api);e.destination=spots.length?markerPoint(spots[Math.floor(random(e)*spots.length)]):{x:e.homeX,y:e.homeY};
      enter(e,"travel");
    }
  } else if(e.state==="travel") {
    const point=e.destination||{x:e.homeX,y:e.homeY},dx=point.x-e.x,dy=point.y-e.y,d=Math.hypot(dx,dy);
    if(d<=32){enter(e,"attack1");e.vx=e.vy=0;}
    else {e.dir=sign(dx)||e.dir;e.vx=dx/d*180;e.vy=dy/d*180;move(e,Math.min(dt,d/180),api);}
  } else {
    face(e,p);e.vx=e.vy=0;
    if(!e.actionDone&&e.state==="attack1"){
      e.actionDone=true;const kind=["Bat","DragonFly","Bee","StandarFireball"][Math.floor(random(e)*4)];
      if(kind==="StandarFireball")shot(e,api,{library:"fireball2",animation:"normal",offsetY:-156,vx:0,vy:0,homingAcceleration:120,homingAfter:1,homingUntil:6,homingMax:400,targetOffsetY:-32});
      else {spawn(e,api,kind,0,-156);api.explosion?.({...e,y:e.y-126});}
    }
    if(e.state==="attack1"&&e.stateTime>=1){
      // attack2 is an animation change within the SAME two-second state.
      e.state="attack2";play(e,"attack2",true);
    }
    if(e.stateTime>=2)enter(e,"normal");
  }
}
const CONTROLLERS={TopoNinja:topo,BigBird:bird,FurryCritter:furry,BigUglyDragon:dragon,
  GiantDragonfly:dragonfly,BigAnguila:anguila,BigPirana:pirana,BigBat:bat,
  BigGhost:ghost,BigSpider:spider,Malmark2:malmark};
export function updateBoss(e,p,dt=1/60,api={}) {
  if(!e||!BOSS_KINDS.has(e.kind))return false;
  initial(e);dt=Number.isFinite(dt)&&dt>=0?dt:1/60;e.t=(e.t||0)+dt;
  if(e.state==="defeated")return true;
  if(e.state==="dying"){e.stateTime+=dt;death(e,api);animation(e,dt,api);return true;}
  e.invulnerableT=Math.max(0,(e.invulnerableT||0)-dt);e.hurtT=Math.max(0,(e.hurtT||0)-dt);
  if(!e.fight){
    if(api.inCamera?.(e)===false&&!api.birdStarted?.()){animation(e,dt,api);return true;}
    e.fight=true;enter(e,e.kind==="TopoNinja"?"stand":"normal");
    if(e.kind==="BigBat")e.vx=e.dir*100;
  }
  if(!e.bossStarted){e.bossStarted=true;api.bossStart?.(e);}
  if(e.hp<=0){die(e);animation(e,dt,api);return true;}
  e.stateTime+=dt;CONTROLLERS[e.kind](e,p||{x:e.homeX,y:e.homeY},dt,api);
  animation(e,dt,api);return true;
}
