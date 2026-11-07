import * as THREE from 'three';

const canvas = document.querySelector('#scene');
const loading = document.querySelector('#loading');
const game = document.querySelector('#game');
const inventoryNames = ['Grass', 'Dirt', 'Stone', 'Wood', 'Leaves'];
const blockColors = {grass:0x79b957,dirt:0x986445,stone:0x909b98,wood:0x9a6842,leaves:0x4c9850};
const inventory = {grass:18,dirt:24,stone:18,wood:16,leaves:12};
const saveKey = 'blockwild-pocket-world-v1';
const blocks = new Map();
const blockMeshes = new Map();
const materialByType = {};
let selected = 'grass';
let worldGroup, avatar, targetBox, raycaster, renderer, scene, camera;
let targetBlock = null, targetFace = null, toastTimer, actionTimer;
let yaw = 0, pitch = 0.47, distance = 9.2;
let player = new THREE.Vector3(0, 0, 0), velocityY = 0, grounded = true;
let joystick = {x:0,y:0}, joystickPointer = null, lookPointer = null;
let gamePaused = false, firstLookHint = true, lastTime = 0;
const keys = new Set();
const clock = new THREE.Clock();
const rayCenter = new THREE.Vector2(0,0);
const tempObject = new THREE.Object3D();
const tempColor = new THREE.Color();

function key(x,y,z){return `${x},${y},${z}`;}
function coords(k){return k.split(',').map(Number);}
function terrainHeight(x,z){return Math.round(1.2 + Math.sin(x*.24)*.75 + Math.cos(z*.27)*.62 + Math.sin((x+z)*.17)*.45);}
function addBlock(x,y,z,type){blocks.set(key(x,y,z),type);}
function buildWorld(){
  blocks.clear();
  for(let x=-15;x<=15;x++)for(let z=-15;z<=15;z++){
    const h=terrainHeight(x,z);
    for(let y=-3;y<=h;y++)addBlock(x,y,z,y===h?'grass':y>=h-2?'dirt':'stone');
  }
  let seed=127;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<20;i++){
    const x=Math.floor(random()*27)-13,z=Math.floor(random()*27)-13;
    if(x*x+z*z<100)continue;
    const ground=terrainHeight(x,z); if(ground < -1)continue;
    const trunk=3+Math.floor(random()*2);
    for(let y=1;y<=trunk;y++)addBlock(x,ground+y,z,'wood');
    for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)for(let dy=trunk-1;dy<=trunk+2;dy++){
      if(Math.abs(dx)+Math.abs(dz)+(dy===trunk+2?1:0)>4)continue;
      if(!blocks.has(key(x+dx,ground+dy,z+dz)))addBlock(x+dx,ground+dy,z+dz,'leaves');
    }
  }
  // A small creek-side patch gives the meadow a little color variation.
  for(let x=-15;x<=-12;x++)for(let z=-4;z<=5;z++){
    const h=terrainHeight(x,z), k=key(x,h,z);
    if(blocks.get(k)==='grass')blocks.set(k,'dirt');
  }
}
function loadSave(){
  try{
    const data=JSON.parse(localStorage.getItem(saveKey)||'null');
    if(data?.blocks){blocks.clear();for(const [k,v] of data.blocks)blocks.set(k,v);}
    if(data?.inventory)Object.assign(inventory,data.inventory);
    if(data?.player?.length===3)player.fromArray(data.player);
    if(data?.selected && inventory[data.selected]!==undefined)selected=data.selected;
    return !!data;
  }catch{return false;}
}
function save(){
  try{localStorage.setItem(saveKey,JSON.stringify({blocks:[...blocks],inventory,player:player.toArray(),selected}));}catch{}
}
function createScene(){
  scene=new THREE.Scene();scene.background=new THREE.Color(0x9bd8e8);scene.fog=new THREE.Fog(0x9bd8e8,24, sixty());
  function sixty(){return 62;}
  camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.1,120);
  renderer=new THREE.WebGLRenderer({canvas,antialias:innerWidth>700,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));renderer.setSize(innerWidth,innerHeight);
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
  scene.add(new THREE.HemisphereLight(0xe4f8ff,0x6a764a,2.1));
  const sun=new THREE.DirectionalLight(0xfff0cc,2.5);sun.position.set(-18,32,14);scene.add(sun);
  const fill=new THREE.DirectionalLight(0xb7e9ff,.65);fill.position.set(14,12,-20);scene.add(fill);
  worldGroup=new THREE.Group();scene.add(worldGroup);
  for(const [type,color] of Object.entries(blockColors))materialByType[type]=new THREE.MeshLambertMaterial({color,flatShading:true});
  buildAvatar();buildTarget();rebuildMeshes();
}
function buildAvatar(){
  avatar=new THREE.Group();
  const shirt=new THREE.MeshLambertMaterial({color:0xe9a64b}), pants=new THREE.MeshLambertMaterial({color:0x476c85}), skin=new THREE.MeshLambertMaterial({color:0xf0c69a}), hair=new THREE.MeshLambertMaterial({color:0x61422c}), dark=new THREE.MeshLambertMaterial({color:0x393e3b});
  const cube=(w,h,d,mat,x,y,z)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);avatar.add(m);return m;};
  cube(.62,.72,.36,shirt,0,1.02,0);cube(.48,.48,.45,skin,0,1.66,0);cube(.5,.2,.48,hair,0,1.94,0);
  cube(.08,.09,.04,dark,-.12,1.69,.235);cube(.08,.09,.04,dark,.12,1.69,.235);
  const legs=[];legs.push(cube(.23,.55,.3,pants,-.16,.37,0));legs.push(cube(.23,.55,.3,pants,.16,.37,0));
  cube(.27,.12,.42,dark,-.16,.08,.04);cube(.27,.12,.42,dark,.16,.08,.04);
  const arm=cube(.22,.58,.25,shirt,.4,1.04,0);arm.rotation.z=-.1;
  avatar.position.set(player.x,player.y,player.z);avatar.rotation.y=Math.PI;scene.add(avatar);
}
function buildTarget(){
  const edges=new THREE.EdgesGeometry(new THREE.BoxGeometry(1.015,1.015,1.015));
  targetBox=new THREE.LineSegments(edges,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.85,depthTest:false}));
  targetBox.visible=false;targetBox.renderOrder=10;scene.add(targetBox);
  raycaster=new THREE.Raycaster();raycaster.far=14;
}
function rebuildMeshes(){
  for(const mesh of blockMeshes.values()){worldGroup.remove(mesh);mesh.dispose?.();}blockMeshes.clear();
  const groups={};for(const type of Object.keys(blockColors))groups[type]=[];
  for(const [k,type] of blocks){const [x,y,z]=coords(k);groups[type]?.push([x,y,z,k]);}
  for(const [type,list] of Object.entries(groups)){
    const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),materialByType[type],Math.max(1,list.length));
    mesh.userData.keys=list.map(b=>b[3]);mesh.count=list.length;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    list.forEach(([x,y,z],i)=>{tempObject.position.set(x,y,z);tempObject.rotation.set(0,0,0);tempObject.scale.set(1,1,1);tempObject.updateMatrix();mesh.setMatrixAt(i,tempObject.matrix);});
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();worldGroup.add(mesh);blockMeshes.set(type,mesh);
  }
}
function floorAt(x,z){
  const bx=Math.round(x),bz=Math.round(z);let highest=-4;
  for(let y=14;y>=-4;y--){
    const type=blocks.get(key(bx,y,bz));
    if(type==='grass'||type==='dirt'||type==='stone'){highest=y;break;}
  }
  return highest+.5;
}
function updateAvatar(dt){
  let forward=0,side=0;
  if(keys.has('KeyW')||keys.has('ArrowUp'))forward+=1;
  if(keys.has('KeyS')||keys.has('ArrowDown'))forward-=1;
  if(keys.has('KeyD')||keys.has('ArrowRight'))side+=1;
  if(keys.has('KeyA')||keys.has('ArrowLeft'))side-=1;
  forward+=-joystick.y;side+=joystick.x;
  const mag=Math.hypot(forward,side);if(mag>1){forward/=mag;side/=mag;}
  if(mag>.04){
    const dx=(-Math.sin(yaw)*forward+Math.cos(yaw)*side)*4.3*dt;
    const dz=(-Math.cos(yaw)*forward-Math.sin(yaw)*side)*4.3*dt;
    const nx=THREE.MathUtils.clamp(player.x+dx,-14.5,14.5),nz=THREE.MathUtils.clamp(player.z+dz,-14.5,14.5);
    const newFloor=floorAt(nx,nz);
    if(newFloor<=player.y+.58){player.x=nx;player.z=nz;}
    else if(grounded&&newFloor<=player.y+1.55){player.x=nx;player.z=nz;player.y=newFloor;velocityY=0;}
    const obstacleY=Math.floor(player.y+1.15);
    if(blocks.has(key(Math.round(player.x),obstacleY,Math.round(player.z)))){player.x=THREE.MathUtils.clamp(player.x-dx,-14.5,14.5);player.z=THREE.MathUtils.clamp(player.z-dz,-14.5,14.5);}
    avatar.rotation.y=Math.atan2(dx,dz);
  }
  velocityY-=19*dt;player.y+=velocityY*dt;
  const floor=floorAt(player.x,player.z);
  if(player.y<=floor){player.y=floor;velocityY=0;grounded=true;}else grounded=false;
  avatar.position.set(player.x,player.y,player.z);
  const target=new THREE.Vector3(player.x-Math.sin(yaw)*2.5,player.y+.9,player.z-Math.cos(yaw)*2.5);
  const horizontal=distance*Math.cos(pitch),vertical=distance*Math.sin(pitch);
  const desired=new THREE.Vector3(target.x+Math.sin(yaw)*horizontal,target.y+vertical,target.z+Math.cos(yaw)*horizontal);
  const obstructionRay=new THREE.Raycaster(target,desired.clone().sub(target).normalize(),0,distance);
  const obstruction=obstructionRay.intersectObjects([...blockMeshes.values()],false)[0];
  if(obstruction)desired.copy(obstruction.point).addScaledVector(obstructionRay.ray.direction,-.32);
  camera.position.lerp(desired,1-Math.exp(-dt*5.5));camera.lookAt(target);
}

const slotRoot=document.querySelector('#slots');
function renderInventory(){
  slotRoot.replaceChildren();
  for(const [type,label] of Object.entries({grass:'Grass',dirt:'Dirt',stone:'Stone',wood:'Wood',leaves:'Leaves'})){
    const slot=document.createElement('button');slot.className=`slot${selected===type?' active':''}`;slot.type='button';slot.setAttribute('aria-label',`${label}, ${inventory[type]} available`);
    slot.innerHTML=`<span class="block-swatch" style="--block:#${blockColors[type].toString(16).padStart(6,'0')}"></span><span class="slot-label">${label}</span><span class="slot-count">${inventory[type]}</span>`;
    slot.addEventListener('click',()=>selectBlock(type));slotRoot.append(slot);
  }
}
function selectBlock(type){selected=type;renderInventory();save();}
function toast(message){
  const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),1700);
}
function updateTarget(){
  raycaster.setFromCamera(rayCenter,camera);
  const hits=raycaster.intersectObjects([...blockMeshes.values()],false);
  if(!hits.length){targetBlock=null;targetFace=null;targetBox.visible=false;document.querySelector('#targetName').textContent='';return;}
  const hit=hits[0],mesh=hit.object,k=mesh.userData.keys[hit.instanceId];
  if(!k){targetBlock=null;targetFace=null;targetBox.visible=false;return;}
  targetBlock=k;targetFace=hit.face?.normal?.clone();
  const [x,y,z]=coords(k);targetBox.position.set(x,y,z);targetBox.visible=true;
  document.querySelector('#targetName').textContent=(blocks.get(k)||'').toUpperCase();
}
function breakBlock(){
  if(gamePaused||!targetBlock)return;
  const type=blocks.get(targetBlock);if(!type)return;
  blocks.delete(targetBlock);inventory[type]=(inventory[type]||0)+1;rebuildMeshes();renderInventory();save();updateTarget();
  toast(`${type[0].toUpperCase()+type.slice(1)} collected`);
}
function placeBlock(){
  if(gamePaused||!targetBlock||!targetFace)return;
  if(inventory[selected]<=0){toast(`No ${selected} left — break blocks to collect more`);return;}
  const [x,y,z]=coords(targetBlock);const nx=x+Math.round(targetFace.x),ny=y+Math.round(targetFace.y),nz=z+Math.round(targetFace.z),k=key(nx,ny,nz);
  if(blocks.has(k))return;
  if(Math.abs(nx-player.x)<.85&&Math.abs(nz-player.z)<.85&&ny<player.y+2.35&&ny+1>player.y){toast('There is no room there');return;}
  blocks.set(k,selected);inventory[selected]--;rebuildMeshes();renderInventory();save();updateTarget();
}
function jump(){if(!gamePaused&&grounded){velocityY=7.1;grounded=false;}}
function openMenu(open=true){
  gamePaused=open;document.querySelector('#modalBackdrop').classList.toggle('open',open);
  if(open){keys.clear();joystick={x:0,y:0};save();}
}
function resetWorld(){
  localStorage.removeItem(saveKey);for(const type of Object.keys(inventory))inventory[type]={grass:18,dirt:24,stone:18,wood:16,leaves:12}[type];
  player.set(0,0,0);selected='grass';buildWorld();player.y=floorAt(0,0);rebuildMeshes();renderInventory();save();openMenu(false);toast('A fresh meadow, just for you');
}
function setupControls(){
  const menuButton=document.querySelector('#menuButton'),resumeButton=document.querySelector('#resumeButton'),resetButton=document.querySelector('#resetButton');
  menuButton.addEventListener('click',()=>openMenu(true));resumeButton.addEventListener('click',()=>openMenu(false));resetButton.addEventListener('click',resetWorld);
  document.querySelector('#breakButton').addEventListener('pointerdown',e=>{e.preventDefault();breakBlock();});
  document.querySelector('#placeButton').addEventListener('pointerdown',e=>{e.preventDefault();placeBlock();});
  document.querySelector('#jumpButton').addEventListener('pointerdown',e=>{e.preventDefault();jump();});
  const joy=document.querySelector('#joystick'),knob=document.querySelector('#joyKnob');
  const moveJoy=e=>{
    if(joystickPointer!==e.pointerId)return;
    const rect=joy.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2,dx=e.clientX-cx,dy=e.clientY-cy,lim=31,len=Math.hypot(dx,dy),scale=len>lim?lim/len:1;
    const px=dx*scale,py=dy*scale;knob.style.transform=`translate(calc(-50% + ${px}px),calc(-50% + ${py}px))`;joystick={x:px/lim,y:py/lim};
  };
  joy.addEventListener('pointerdown',e=>{e.preventDefault();joystickPointer=e.pointerId;joy.setPointerCapture(e.pointerId);moveJoy(e);});
  joy.addEventListener('pointermove',moveJoy);
  const endJoy=e=>{if(joystickPointer===e.pointerId){joystickPointer=null;joystick={x:0,y:0};knob.style.transform='translate(-50%,-50%)';}};
  joy.addEventListener('pointerup',endJoy);joy.addEventListener('pointercancel',endJoy);
  game.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&e.button===2){e.preventDefault();placeBlock();return;}
    if(e.pointerType!=='mouse'&&e.target.closest('button,.joystick,.hotbar,.mission,.icon-button'))return;
    if(e.pointerType==='mouse'&&e.button!==0)return;
    lookPointer={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,button:e.button,type:e.pointerType};
    if(e.pointerType==='mouse')game.setPointerCapture(e.pointerId);
  });
  game.addEventListener('pointermove',e=>{
    if(!lookPointer||lookPointer.id!==e.pointerId)return;
    const dx=e.clientX-lookPointer.x,dy=e.clientY-lookPointer.y;lookPointer.x=e.clientX;lookPointer.y=e.clientY;
    yaw-=dx*.006;pitch=THREE.MathUtils.clamp(pitch+dy*.004,-.05,1.05);
    if(firstLookHint&&Math.abs(dx)+Math.abs(dy)>4){firstLookHint=false;document.querySelector('#hint').style.opacity='0';}
  });
  const endLook=e=>{
    if(lookPointer?.id!==e.pointerId)return;
    const moved=Math.hypot(e.clientX-lookPointer.startX,e.clientY-lookPointer.startY);
    if(lookPointer.type==='mouse'&&lookPointer.button===0&&moved<7)breakBlock();
    lookPointer=null;
  };
  game.addEventListener('pointerup',endLook);game.addEventListener('pointercancel',endLook);
  game.addEventListener('contextmenu',e=>e.preventDefault());
  window.addEventListener('keydown',e=>{
    if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
    if(e.code==='Escape'||e.code==='KeyE'){openMenu(!gamePaused);return;}
    if(e.code==='Space'){jump();return;}
    if(/^Digit[1-5]$/.test(e.code)){selectBlock(Object.keys(blockColors)[Number(e.code.slice(-1))-1]);return;}
    if(!gamePaused)keys.add(e.code);
  });
  window.addEventListener('keyup',e=>keys.delete(e.code));
  canvas.addEventListener('dblclick',e=>e.preventDefault());
  window.addEventListener('blur',()=>{keys.clear();joystick={x:0,y:0};});
  window.addEventListener('beforeunload',save);
  window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));renderer.setSize(innerWidth,innerHeight);});
}
function animate(now){
  requestAnimationFrame(animate);
  const dt=Math.min(.05,(now-lastTime)/1000||clock.getDelta());lastTime=now;
  if(!gamePaused){updateAvatar(dt);updateTarget();}
  renderer.render(scene,camera);
}
function start(){
  try{
    const hadSave=loadSave();
    if(!hadSave){buildWorld();player.y=floorAt(player.x,player.z);}
    createScene();renderInventory();setupControls();
    requestAnimationFrame(now=>{lastTime=now;requestAnimationFrame(animate);});
    setTimeout(()=>loading.classList.add('done'),450);
    if(!sessionStorage.getItem('blockwild-hint-seen')){
      setTimeout(()=>{document.querySelector('#hint').style.opacity='0';sessionStorage.setItem('blockwild-hint-seen','1');},6500);
    }
    save();
  }catch(error){
    console.error('Blockwild could not start',error);
    loading.innerHTML='<b>WORLD UNAVAILABLE</b><span>Please reload this page to try again.</span>';
  }
}
start();
