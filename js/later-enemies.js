// Explicit behavior families for later-map actors. Descriptor/art selection is
// recovered; timer/steering approximations are listed separately in the docs.
const approach=(v,target,delta)=>v+Math.sign(target-v)*Math.min(Math.abs(target-v),delta);
export function updateLaterEnemy(e,player,dt,api) {
  const {moveBody,tileAt,shoot,spawn,nearby}=api;
  const dx=player.x-e.x,dy=player.y-e.y;
  const animate=(name,restart=false)=>{if(e.anim?.has(name)){e.anim.set(name,{restart});e.cur=e.anim.frame;}};
  const face=()=>{e.dir=Math.sign(dx)||e.dir;};
  const attack=(options={})=>shoot(e,options);
  if(e.behavior==="boss-pending") {
    // Do not make an unimplemented boss pursue like a ground beetle. Its own
    // descriptor/art remains available, with its full state machine still pending.
    e.vx=e.vy=0;
  } else if(e.behavior==="hive") {
    animate("panal");
    if(e.cooldown<=0){if((nearby?.("Bee",e)||0)<4)spawn?.("Bee",e.x,e.y-50,e.dir,e);e.cooldown=2;}
  } else if(["flying-seek","flying-shooter"].includes(e.behavior)) {
    face();e.vx=approach(e.vx,Math.sign(dx)*e.speed,e.acceleration*dt);
    e.vy=approach(e.vy,Math.sign(dy-30)*e.speed,e.acceleration*dt);e.x+=e.vx*dt;e.y+=e.vy*dt;
    if(e.behavior==="flying-shooter"&&e.cooldown<=0){attack({aim:true});e.cooldown=e.attackDelay;}
  } else if(e.behavior==="swim-patrol") {
    e.vx=e.dir*e.speed;const x=e.x+e.vx*dt;
    if(tileAt(Math.floor((x+e.dir*e.w/2)/32),Math.floor((e.y-e.h/2)/32))&1)e.dir*=-1;
    else e.x=x;
  } else if(e.behavior==="piranha"||e.behavior==="blowfish") {
    if(e.behavior==="blowfish") {
      const distance=Math.hypot(dx,dy);
      if(e.state==="normal"&&distance<200){e.state="activated";animate("activated",true);}
      else if(e.state==="activated"&&distance>250){e.state="normal";animate("sleep",true);}
    } else if(e.state==="normal"&&Math.hypot(dx,dy)<128&&e.stateTime>=1){e.state="attack";e.stateTime=0;animate("attack",true);}
    if(e.state==="attack"||e.state==="activated") {
      face();e.vx=approach(e.vx,e.dir*e.speed*2,320*dt);e.vy=approach(e.vy,Math.sign(dy)*e.speed,320*dt);
      if(e.behavior==="piranha"&&e.stateTime>=1){e.state="normal";e.stateTime=0;animate("normal");}
    } else {e.vx=e.dir*e.speed;e.vy=0;}
    const x=e.x+e.vx*dt,y=e.y+e.vy*dt;
    if(tileAt(Math.floor((x+e.dir*e.w/2)/32),Math.floor((y-e.h/2)/32))&1){e.dir*=-1;e.vx*=-1;}
    else {e.x=x;e.y=y;}
  } else if(e.behavior==="falling-trap") {
    if(e.state==="normal") {e.visible=false;if(Math.hypot(dx,dy)<250){e.state="appear";e.stateTime=0;e.visible=true;animate("appear",true);}}
    else if(e.state==="appear"&&(e.anim?.finished||e.stateTime>.5)){e.state="falling";e.stateTime=0;animate("normal",true);}
    else if(e.state==="falling") {
      if(e.stateTime>.5){e.vy+=960*dt;e.vx=approach(e.vx,Math.sign(dx)*180,240*dt);e.x+=e.vx*dt;e.y+=e.vy*dt;}
      if(e.stateTime>7||e.y>player.y+700){e.removed=true;e.hp=0;}
    }
  } else if(e.behavior==="spider"||e.behavior==="mouse"||e.behavior==="volcano") {
    if(e.behavior==="mouse"){face();e.vx=approach(e.vx,e.dir*e.speed,e.acceleration*dt);}
    else e.vx=e.state==="attack"?0:e.dir*e.speed;
    if(e.dontFall&&e.ground&&!(tileAt(Math.floor((e.x+e.dir*(e.w/2+5))/32),Math.floor((e.y+5)/32))&3))e.dir*=-1;
    const grounded=e.ground;moveBody(e,dt,e.gravity);
    if(e.hitWall){if(e.behavior==="mouse"&&grounded){e.vy=-e.jumpSpeed;e.ground=false;e.state="jump";animate("jump",true);}else e.dir*=-1;}
    if(e.behavior==="spider"&&e.cooldown<=0&&e.ground){e.vy=-200;e.ground=false;e.cooldown=2;e.state="jump";animate("jump",true);}
    if(e.state==="jump"&&e.ground){e.state="normal";animate("normal");}
    if(e.behavior==="volcano"&&e.state==="normal"&&e.cooldown<=0){
      e.state="attack";e.stateTime=0;animate("attack",true);
      for(const vx of [-120,0,120])attack({fireball:true,vx,vy:-240,gravity:960});
    }
    if(e.behavior==="volcano"&&e.state==="attack"&&(e.anim?.finished||e.stateTime>1)){e.state="normal";e.cooldown=2;animate("normal");}
  } else if(["shell","snake","side-column","front-column"].includes(e.behavior)) {
    if(e.behavior==="snake"&&!e.emerged){
      if(Math.abs(dx)>96){e.visible=false;return true;}
      e.visible=true;e.emerged=true;animate("normal",true);
    }
    if(!["side-column","front-column"].includes(e.behavior))face();
    const canFire=e.behavior!=="side-column"||(dx*e.dir>0&&Math.abs(dx)<512);
    if(e.state==="normal"&&e.cooldown<=0&&canFire){e.state="attack";e.stateTime=0;e.shotFired=false;animate("attack",true);}
    if(e.state==="attack") {
      const flags=e.anim?.frame?.flags||[];
      if(!e.shotFired&&(flags.includes("Custom")||!e.anim?.has("attack")||e.stateTime>.3)) {
        if(e.behavior==="front-column")for(const angle of [-.35,0,.35])attack({aim:true,angle});
        else attack({aim:e.behavior!=="side-column",fireball:e.behavior==="side-column"});
        e.shotFired=true;
      }
      if(e.anim?.finished||e.stateTime>1){e.state="normal";e.cooldown=e.attackDelay;animate("normal");}
    }
  } else return false;
  return true;
}
