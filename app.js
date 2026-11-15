'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const STORAGE_KEY = 'svoi-tyumen-v1';
const EVENT_POINT = [57.1646, 65.5275];
const DEFAULT_CENTER = [57.1580, 65.5350];
const seeds = [
  {id:'pothole-1',category:'pothole',title:'Яма у пешеходного перехода',description:'Асфальт просел, после дождя ямы почти не видно. Отметили место, чтобы обратить на него внимание.',address:'ул. Республики, 12',lat:57.1605,lng:65.5239,likes:24,author:'Алексей',comments:[{name:'Мария',text:'Тоже заметила. Спасибо за отметку!'}]},
  {id:'trash-1',category:'trash',title:'Мусор рядом с набережной',description:'У дорожки остались бутылки и упаковка. Давайте вернём этому месту чистоту вместе.',address:'Набережная Туры',lat:57.1626,lng:65.5417,likes:38,author:'Аня',comments:[{name:'Никита',text:'Могу захватить пакеты на уборку.'}]},
  {id:'trash-2',category:'trash',title:'Стаканчики в зелёной зоне',description:'После выходных в сквере остался мусор. Небольшое дело, с которого можно начать.',address:'ул. Ленина, 10',lat:57.1556,lng:65.5305,likes:17,author:'Даша',comments:[]},
  {id:'pothole-2',category:'pothole',title:'Повреждён асфальт во дворе',description:'На въезде во двор разбито покрытие. Поддержите отметку, если тоже сталкиваетесь с этой проблемой.',address:'ул. Республики, 28',lat:57.1567,lng:65.5395,likes:12,author:'Илья',comments:[]}
];
const freshState = () => ({version:1,xp:640,joined:false,eventComplete:false,teams:[],issues:seeds.map(item=>({...item,liked:false,resolved:false,comments:item.comments.map(c=>({...c}))})),reports:[]});
let state = freshState();
let storageWarning = false;
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if(saved?.version === 1 && Array.isArray(saved.issues) && Number.isFinite(saved.xp) && Array.isArray(saved.teams) && Array.isArray(saved.reports)) {
    saved.issues = saved.issues.filter(i => typeof i.id === 'string' && ['trash','pothole'].includes(i.category) && Number.isFinite(i.lat) && Number.isFinite(i.lng) && Number.isFinite(i.likes)).map(i=>({...i,comments:Array.isArray(i.comments)?i.comments:[],photo:typeof i.photo==='string'&&/^data:image\/(jpeg|png|webp);base64,/.test(i.photo)?i.photo:null}));
    state = saved;
  }
} catch {storageWarning = true;}
let activeFilter = 'all';
let map;
let issueLayers;
let pickHandler = null;
let activeView = 'map';
let draft = null;
let lastFocus;
let activeSheet = '';
let toastTimer;

function persist(){
  try {localStorage.setItem(STORAGE_KEY, JSON.stringify(state));return true;}
  catch {toast('Память браузера заполнена: изменения доступны до закрытия страницы');return false;}
}
function toast(message){
  const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('visible'),3800);
}
function level(){return 7+Math.floor(Math.max(0,state.xp-640)/160);}
function nextLevelXP(){return 800+Math.floor(Math.max(0,state.xp-640)/160)*160;}
function cleanCount(){return 14+state.reports.length;}
function updateUI(){
  $('#clean-count').textContent=cleanCount();
  $('#weekly-count').textContent=`${Math.min(cleanCount(),20)}/20`;
  $('#weekly-progress').style.width=`${Math.min(cleanCount()/20*100,100)}%`;
  $('#sidebar-level').textContent=`Уровень ${level()}`;
  $('#sidebar-xp').textContent=`${state.xp} / ${nextLevelXP()} XP`;
  $('#mini-progress').style.width=`${state.xp/nextLevelXP()*100}%`;
  $('#total-count').textContent=state.issues.filter(i=>!i.resolved).length;
  $('#participant-label').textContent=state.joined?'Ты + 12 своих':'Уже 12 своих';
  $('#join-event').innerHTML=state.eventComplete?`Дело сделано ${icon('check')}`:state.joined?`Я на месте — фотоотчёт ${icon('camera')}`:`Я с вами ${icon('arrow')}`;
  $('#event-footnote').textContent=state.eventComplete?'Спасибо! Набережная стала чище благодаря тебе':state.joined?'Встречаемся у Моста Влюблённых в 16:00':'Доброе дело подтвердим фотоотчётом';
  $('#event-dot').hidden=!state.joined||state.eventComplete;
  renderMarkers();
}
function sheet(html,view='map'){
  lastFocus=document.activeElement;
  $('#sheet-content').innerHTML=html;
  activeSheet=view;
  setNav(view);
  if(!$('#sheet').open) $('#sheet').showModal();
  $('#sheet').scrollTop=0;
}
function closeSheet(){
  $('#sheet').close();activeSheet='';setNav('map');
  if(lastFocus?.isConnected) lastFocus.focus({preventScroll:true});
}
function setNav(view){activeView=view;$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));}
function photoStyle(issue){
  return issue.photo?`style="background-image:url('${esc(issue.photo)}')"`:'';
}
function photoClass(issue){return issue.photo?'uploaded-photo':`sprite-photo ${issue.category}`;}
function issueName(issue){return issue.category==='trash'?'Мусор':'Яма';}
function filteredIssues(){return state.issues.filter(i=>activeFilter==='resolved'?i.resolved:!i.resolved&&(activeFilter==='all'||i.category===activeFilter));}

function initMap(){
  if(!window.L){$('#map').innerHTML='<p class="empty-state">Библиотека карты не найдена. Распакуйте весь архив и запустите приложение ещё раз.</p>';return;}
  map=L.map('map',{zoomControl:false,minZoom:12,maxZoom:19,attributionControl:true}).setView(DEFAULT_CENTER,15);
  const bounds=[[57.143,65.502],[57.179,65.565]];
  L.imageOverlay('assets/map-fallback.svg',bounds,{pane:'tilePane',zIndex:0,interactive:false}).addTo(map);
  const tile=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,zIndex:1,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map);
  let loaded=0,failed=0;
  tile.on('tileload',()=>{loaded++;$('#offline-note').hidden=true;});
  tile.on('tileerror',()=>{failed++;if(!loaded&&failed>2)$('#offline-note').hidden=false;});
  setTimeout(()=>{if(!loaded)$('#offline-note').hidden=false;},4500);
  issueLayers=L.layerGroup().addTo(map);
  L.marker([57.1555,65.5220],{icon:L.divIcon({html:'<div class="user-dot"></div>',className:'',iconSize:[18,18],iconAnchor:[9,9]}),interactive:false}).addTo(map);
  const event=L.marker(EVENT_POINT,{icon:L.divIcon({html:`<div class="event-pin">${icon('leaf')} Уборка · 16:00</div>`,className:'',iconSize:[176,42],iconAnchor:[88,42]}),title:'Открыть событие Уборка в 16:00',autoPanOnFocus:false,zIndexOffset:200}).addTo(map);
  event.on('click',()=>showEvents());
  map.on('click',e=>{if(pickHandler){const fn=pickHandler;endPick();fn(e.latlng);}});
  renderMarkers();
  requestAnimationFrame(centerMap);
  let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{map.invalidateSize();centerMap();},180);});
}
function centerMap(){
  if(!map)return;
  const mobile=matchMedia('(max-width:760px)').matches;
  map.invalidateSize();
  const size=map.getSize();
  const top=mobile?110:155;
  const cardHeight=$('.event-card').getBoundingClientRect().height;
  const bottom=mobile?cardHeight+110:cardHeight+50;
  const targetY=(top+Math.max(top+120,size.y-bottom))/2;
  const zoom=size.x<600?14:15;
  map.setView([57.1600,65.5340],zoom,{animate:false});
  map.panBy([0,size.y/2-targetY],{animate:false});
}
function renderMarkers(){
  if(!issueLayers)return;
  issueLayers.clearLayers();
  const items=filteredIssues();
  $('#map-count').textContent=`${items.length} ${items.length===1?'отметка':items.length>=2&&items.length<=4?'отметки':'отметок'}`;
  for(const issue of items){
    const html=`<div class="photo-pin ${issue.liked?'liked':''} ${issue.resolved?'resolved':''}" role="button" tabindex="0" aria-label="${esc(issue.title)}, ${issue.likes} лайков"><div class="pin-photo ${photoClass(issue)}" ${photoStyle(issue)}></div><div class="pin-label"><span>${issueName(issue)}</span><span class="pin-likes">${icon(issue.resolved?'check':'heart')}${issue.likes}</span></div></div>`;
    const mobile=matchMedia('(max-width:760px)').matches;
    const marker=L.marker([issue.lat,issue.lng],{icon:L.divIcon({html,className:'',iconSize:mobile?[88,92]:[106,110],iconAnchor:mobile?[44,92]:[53,110]}),keyboard:false,autoPanOnFocus:false}).addTo(issueLayers);
    marker.on('click',()=>showIssue(issue.id));
    marker.getElement()?.querySelector('.photo-pin').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showIssue(issue.id);}});
  }
}
function likeIssue(id){
  const issue=state.issues.find(i=>i.id===id);if(!issue)return;
  issue.liked=!issue.liked;issue.likes+=issue.liked?1:-1;persist();updateUI();showIssue(id);
}
function showIssue(id){
  const issue=state.issues.find(i=>i.id===id);if(!issue)return;
  sheet(`<div class="detail-photo ${photoClass(issue)}" ${photoStyle(issue)} role="img" aria-label="Фото: ${esc(issue.title)}"></div><div class="sheet-body"><div class="badge-row"><span class="tag ${issue.resolved?'green':'coral'}">${issue.resolved?'Решено':'Открыто'}</span><span class="tag">${icon(issue.category==='trash'?'trash':'road')}${issueName(issue)}</span></div><h2>${esc(issue.title)}</h2><div class="detail-address">${icon('pin')}${esc(issue.address)}</div><div class="author-row"><span class="avatar avatar-one"></span><span><b>${esc(issue.author)}</b> · ${issue.created?'Только что':'Сегодня'}</span></div><p class="detail-description">${esc(issue.description)}</p><button class="outline-button ${issue.liked?'liked':''}" id="like-issue">${icon('heart')}${issue.liked?'Поддержано':'Тоже вижу'} · ${issue.likes}</button>${issue.category==='trash'&&!issue.resolved?`<button class="primary" id="resolve-issue">Убрали? Покажи результат ${icon('camera')}</button><p class="action-note">Фото до и после → +75 XP и чище в городе</p>`:issue.resolved?'<p class="action-note">Место стало чище. Спасибо за вклад!</p>':'<p class="action-note">Поддержка помогает показать, какие места требуют внимания.</p>'}<div class="comment-list"><h3>Обсуждение · ${issue.comments.length}</h3><div id="comments">${issue.comments.map(c=>`<div class="comment"><span class="comment-avatar">${esc(String(c.name).charAt(0))}</span><div><strong>${esc(c.name)}</strong><p>${esc(c.text)}</p></div></div>`).join('')||'<p class="empty-state">Начни обсуждение — предложи помощь или добавь подробности.</p>'}</div><form class="comment-form" id="comment-form"><input name="comment" maxlength="300" placeholder="Написать комментарий…" aria-label="Комментарий" required><button aria-label="Отправить комментарий">${icon('arrow')}</button></form></div></div>`);
  $('#like-issue').onclick=()=>likeIssue(id);
  if($('#resolve-issue'))$('#resolve-issue').onclick=()=>showReport('issue',id);
  $('#comment-form').onsubmit=e=>{e.preventDefault();const text=e.target.elements.comment.value.trim();if(!text)return;issue.comments.push({name:'Саша',text});persist();showIssue(id);};
}

function newDraft(){return {title:'',description:'',category:'trash',photo:null,lat:57.1590,lng:65.5355,address:'Центр Тюмени'};}
function captureDraft(){
  const form=$('#issue-form');if(!form)return;
  draft.title=form.elements.title.value;draft.description=form.elements.description.value;draft.category=form.elements.category.value;draft.address=form.elements.address.value;
}
function showAdd(keep=false){
  if(!keep||!draft)draft=newDraft();
  sheet(`<div class="sheet-body"><p class="eyebrow">Начни с малого</p><h2>Новая отметка</h2><p class="subtext">Заметил проблему? Покажи её своим.</p><form id="issue-form"><label class="upload-box ${draft.photo?'has-photo':''}" id="photo-box">${draft.photo?`<img src="${esc(draft.photo)}" alt="Загруженное фото">`:icon('camera')+'<strong>Добавить фото проблемы</strong><small>JPG, PNG или WebP · до 15 МБ</small>'}<input type="file" id="issue-photo" accept="image/jpeg,image/png,image/webp" hidden></label><div class="form-field"><span>Категория</span><div class="category-options"><label><input type="radio" name="category" value="trash" ${draft.category==='trash'?'checked':''}><span>${icon('trash')}Мусор</span></label><label><input type="radio" name="category" value="pothole" ${draft.category==='pothole'?'checked':''}><span>${icon('road')}Яма</span></label></div></div><label class="form-field"><span>Что случилось?</span><input class="text-input" name="title" maxlength="80" placeholder="Например, мусор у остановки" value="${esc(draft.title)}" required></label><label class="form-field"><span>Описание</span><textarea class="text-input" name="description" maxlength="600" placeholder="Добавь подробности: где именно и что нужно сделать" required>${esc(draft.description)}</textarea></label><label class="form-field"><span>Адрес или ориентир</span><input class="text-input" name="address" maxlength="100" value="${esc(draft.address)}" required></label><div class="location-card">${icon('pin')}<span>Место на карте</span><button type="button" id="pick-location">Выбрать точку</button></div><p class="coordinate-label">${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}</p><p class="sheet-error" id="form-error" hidden></p><button class="primary" id="publish-issue" type="submit">Опубликовать ${icon('plus')}</button><p class="action-note">Отметка появится на твоей карте. XP — за выполненные дела.</p></form></div>`);
  $('#issue-photo').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    captureDraft();const button=$('#publish-issue');button.disabled=true;
    try {draft.photo=await readPhoto(file);showAdd(true);}catch(err){showError('#form-error',err.message);button.disabled=false;}
  };
  $('#pick-location').onclick=()=>{captureDraft();closeSheet();beginPick(latlng=>{draft.lat=latlng.lat;draft.lng=latlng.lng;showAdd(true);},()=>showAdd(true));};
  $('#issue-form').onsubmit=e=>{
    e.preventDefault();captureDraft();
    if(!draft.photo){showError('#form-error','Добавь фото, чтобы другим было проще найти проблему.');return;}
    if(!draft.title.trim()||!draft.description.trim()||!draft.address.trim()){showError('#form-error','Заполни название, описание и адрес.');return;}
    const issue={...draft,id:`local-${Date.now()}-${Math.random().toString(16).slice(2,7)}`,title:draft.title.trim(),description:draft.description.trim(),address:draft.address.trim(),likes:0,liked:false,resolved:false,author:'Саша',comments:[],created:Date.now()};
    state.issues.push(issue);persist();draft=null;setFilter('all');updateUI();closeSheet();map?.setView([issue.lat,issue.lng],16);toast('Отметка на карте. Спасибо, что замечаешь!');
  };
}
function showError(selector,message){const el=$(selector);if(el){el.textContent=message;el.hidden=false;}}
function readPhoto(file){
  return new Promise((resolve,reject)=>{
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){reject(new Error('Выбери фотографию в формате JPG, PNG или WebP.'));return;}
    if(file.size>15*1024*1024){reject(new Error('Файл больше 15 МБ. Выбери фото поменьше.'));return;}
    const url=URL.createObjectURL(file);const img=new Image();
    img.onload=()=>{try{const max=1000;const scale=Math.min(1,max/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',.75));}catch{reject(new Error('Не удалось прочитать фото. Попробуй другое.'));}finally{URL.revokeObjectURL(url);}};
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Не удалось открыть фото. Попробуй другое.'));};img.src=url;
  });
}
function beginPick(onPick,onCancel){
  if(!map){toast('Карта ещё не готова');onCancel();return;}
  pickHandler=onPick;document.body.classList.add('picking');
  const hint=document.createElement('div');hint.className='picking-hint';hint.innerHTML='Нажми на нужное место на карте <button>Отмена</button>';$('.map-stage').append(hint);hint.querySelector('button').onclick=()=>{endPick();onCancel();};
  map.invalidateSize();
}
function endPick(){pickHandler=null;document.body.classList.remove('picking');$('.picking-hint')?.remove();}
function setFilter(value){
  activeFilter=value;$$('.filter').forEach(button=>button.classList.toggle('active',button.dataset.filter===value));renderMarkers();
  if(!filteredIssues().length)toast(value==='resolved'?'Здесь появятся места после подтверждения уборки':'В этой категории пока нет отметок');
}

const teams=[{id:'embankment',emoji:'🌊',title:'Свои на набережной',text:'Гуляем вдоль Туры, знакомимся и делаем любимые места чище.',people:24},{id:'students',emoji:'✳',title:'Студенты за город',text:'Команда для тех, кто хочет начать. Маленькие дела после пар.',people:38},{id:'weekend',emoji:'☀',title:'Добрые выходные',text:'Суббота, кофе и пара часов с пользой для города.',people:19}];
function showTeam(){
  sheet(`<div class="sheet-body"><p class="eyebrow">Вместе веселее</p><h2>Найди своих</h2><p class="subtext">Не обязательно менять весь город в одиночку.<br>Начни с хорошей компании.</p>${teams.map(t=>`<article class="team-card ${state.teams.includes(t.id)?'joined':''}"><div class="team-card-head"><span class="team-emoji">${t.emoji}</span><div><h3>${t.title}</h3><p>${t.people+(state.teams.includes(t.id)?1:0)} участников · Тюмень</p></div></div><p>${t.text}</p><button class="outline-button" data-team="${t.id}">${state.teams.includes(t.id)?icon('check')+'Ты в команде · Выйти':'Вступить в команду '+icon('arrow')}</button></article>`).join('')}<p class="demo-caption">Команды и участники — примеры для демки. Выбранные команды сохраняются в твоём браузере.</p></div>`,'team');
  $$('[data-team]').forEach(button=>button.onclick=()=>{const id=button.dataset.team;const joined=state.teams.includes(id);state.teams=joined?state.teams.filter(t=>t!==id):[...state.teams,id];persist();showTeam();toast(joined?'Ты вышел из команды':'Теперь ты в команде. Знакомство начинается с дела!');});
}
function joinEvent(){
  if(state.eventComplete){showEvents();return;}
  if(state.joined){showReport('event');return;}
  state.joined=true;persist();updateUI();showEvents();toast('Ты в списке! Встречаемся сегодня в 16:00');
}
function showEvents(){
  sheet(`<div class="sheet-body"><p class="eyebrow">Увидимся в городе</p><h2>Добрые планы</h2><p class="subtext">Одно событие — много маленьких перемен.</p><div class="event-detail-banner">${icon('leaf')}<h3>Сделаем набережную чище</h3><p>Сегодня, 16:00–17:30<br>Набережная Туры, у Моста Влюблённых</p><div class="event-social"><span class="tag">${icon('users')}${state.joined?'Ты + 12 своих':'12 участников'}</span><span class="xp-badge">+150 XP</span></div></div>${state.eventComplete?'<div class="completed-event">✓ Дело сделано! Твой фотоотчёт сохранён.<br>+150 XP уже в профиле.</div>':`<ul class="check-list"><li>${icon('check')}Возьми перчатки и удобную обувь</li><li>${icon('check')}Пакеты будут у организатора</li><li>${icon('check')}Сделай фото места до и после уборки</li></ul><button class="primary" id="event-action">${state.joined?'Отправить фотоотчёт '+icon('camera'):'Я с вами '+icon('arrow')}</button>${state.joined?'<button class="outline-button" id="leave-event">Планы изменились — отменить участие</button>':''}`}<p class="demo-caption">Это демонстрационное событие. Запись и фотоотчёт сохраняются локально, организатору ничего не отправляется.</p></div>`,'events');
  if($('#event-action'))$('#event-action').onclick=()=>state.joined?showReport('event'):joinEvent();
  if($('#leave-event'))$('#leave-event').onclick=()=>{state.joined=false;persist();updateUI();showEvents();toast('Участие отменено. До следующего доброго дела!');};
}
function showReport(type,id){
  const issue=type==='issue'?state.issues.find(i=>i.id===id):null;
  if(type==='issue'&&(!issue||issue.resolved))return;
  if(type==='event'&&(!state.joined||state.eventComplete))return;
  const photos={before:null,after:null};let pending=0;
  sheet(`<div class="sheet-body"><p class="eyebrow">Покажи перемены</p><h2>До → после</h2><p class="subtext">${type==='event'?'Набережная Туры':esc(issue.title)}<br>Добавь два фото одного места и заверши доброе дело.</p><form id="report-form"><div class="report-grid">${['before','after'].map((key,i)=>`<label class="upload-box" id="upload-${key}">${icon('camera')}<strong>${i===0?'До уборки':'После уборки'}</strong><small>Добавить фото</small><input type="file" accept="image/jpeg,image/png,image/webp" data-report-photo="${key}" hidden></label>`).join('')}</div><label class="form-field"><span>Как всё прошло? <span style="font-weight:400;color:#999">Необязательно</span></span><textarea name="note" class="text-input" maxlength="500" placeholder="Что удалось сделать?"></textarea></label><p class="sheet-error" id="report-error" hidden></p><button class="primary" id="submit-report">Завершить дело · +${type==='event'?150:75} XP ${icon('check')}</button><p class="action-note">В демке XP начисляется после загрузки двух фото.<br>В полноценном приложении отчёты проверяет модератор.</p></form></div>`,'events');
  $$('[data-report-photo]').forEach(input=>input.onchange=async()=>{
    const file=input.files[0];if(!file)return;pending++;$('#submit-report').disabled=true;
    try{photos[input.dataset.reportPhoto]=await readPhoto(file);const box=$(`#upload-${input.dataset.reportPhoto}`);box.querySelector('img')?.remove();const img=document.createElement('img');img.src=photos[input.dataset.reportPhoto];img.alt=input.dataset.reportPhoto==='before'?'До уборки':'После уборки';box.prepend(img);box.classList.add('has-photo');}catch(err){showError('#report-error',err.message);}finally{pending--;if($('#submit-report'))$('#submit-report').disabled=pending>0;}
  });
  $('#report-form').onsubmit=e=>{
    e.preventDefault();if(pending)return;
    if(!photos.before||!photos.after){showError('#report-error','Добавь оба фото: до и после уборки.');return;}
    if(photos.before===photos.after){showError('#report-error','Добавь разные фотографии до и после уборки.');return;}
    if(type==='event'&&state.eventComplete||type==='issue'&&issue.resolved)return;
    const reward=type==='event'?150:75;
    state.reports.push({id:`report-${Date.now()}`,type,issueId:id||null,note:e.target.elements.note.value.trim(),photos,created:Date.now()});
    if(type==='event')state.eventComplete=true;else issue.resolved=true;
    state.xp+=reward;persist();updateUI();showSuccess(reward);confetti();
  };
}
function showSuccess(reward){
  sheet(`<div class="sheet-body celebration"><div class="celebration-icon">✳</div><p class="eyebrow">Вот это по-нашему</p><h2>Город стал лучше.<br>Благодаря тебе.</h2><p>Фотоотчёт сохранён, доброе дело — в копилке.<br>Ты на шаг ближе к следующему уровню.</p><div class="big-xp">+${reward} XP</div><span class="tag">Уровень ${level()} · ${state.xp} XP</span><div class="weekly-card" style="text-align:left"><strong>Общая цель: ${Math.min(cleanCount(),20)} из 20 мест</strong><div class="progress-track"><div style="width:${Math.min(cleanCount()/20*100,100)}%"></div></div><small>Маленькое дело — большой вклад.</small></div><button class="primary" id="back-to-map">На карту ${icon('arrow')}</button></div>`,'profile');
  $('#back-to-map').onclick=closeSheet;
}
function confetti(){
  if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  for(let i=0;i<38;i++){const el=document.createElement('i');el.className='confetti';el.style.left=`${Math.random()*100}%`;el.style.background=['#1745ff','#ff725c','#bde7bd','#ffcf5c'][i%4];el.style.animationDelay=`${Math.random()*.4}s`;el.style.setProperty('--drift',`${Math.random()*300-150}px`);document.body.append(el);setTimeout(()=>el.remove(),3000);}
}
function showProfile(){
  const reports=state.reports;
  sheet(`<div class="sheet-body"><div class="profile-header"><span class="avatar avatar-self"></span><h2>Саша</h2><span class="tag">${icon('spark')}Уровень ${level()}</span></div><div class="profile-stats"><div><strong>${state.xp}</strong><span>всего XP</span></div><div><strong>${reports.length}</strong><span>добрых дел</span></div><div><strong>${state.teams.length}</strong><span>команды</span></div></div><div class="profile-block"><h3>Ещё немного до уровня ${level()+1}</h3><div class="progress-track"><div style="width:${Math.min(state.xp/nextLevelXP()*100,100)}%"></div></div><p class="subtext">${state.xp} из ${nextLevelXP()} XP · хорошее дело всегда рядом</p></div><div class="profile-block"><h3>Твои достижения</h3><div class="achievement"><span>${icon('pin')}</span><div><strong>Свои в городе</strong><p>Ты здесь. Это уже первый шаг.</p></div></div><div class="achievement ${reports.length?'':'locked'}"><span>${icon('leaf')}</span><div><strong>Первое доброе дело</strong><p>${reports.length?'Первый фотоотчёт — готово!':'Заверши уборку и добавь фотоотчёт.'}</p></div></div><div class="achievement ${state.teams.length?'':'locked'}"><span>${icon('users')}</span><div><strong>Часть команды</strong><p>${state.teams.length?'Свои найдены. Вместе веселее!':'Присоединись к городской команде.'}</p></div></div></div><div class="profile-block"><h3>Мои отметки</h3>${state.issues.filter(i=>i.created).map(i=>`<button class="search-result" data-open-issue="${esc(i.id)}">${icon(i.category==='trash'?'trash':'road')}<span><strong>${esc(i.title)}</strong><small>${esc(i.address)}</small></span>${icon('chevron')}</button>`).join('')||'<p class="subtext">Пока пусто. Заметишь проблему — добавь её на карту.</p>'}</div><div class="profile-block"><h3>Мои фотоотчёты</h3>${reports.map((r,i)=>`<button class="search-result" data-report-index="${i}">${icon('check')}<span><strong>${r.type==='event'?'Уборка набережной':esc(state.issues.find(x=>x.id===r.issueId)?.title||'Уборка')}</strong><small>+${r.type==='event'?150:75} XP · ${new Date(r.created).toLocaleDateString('ru-RU')}</small></span>${icon('chevron')}</button>`).join('')||'<p class="subtext">Здесь будут фотоотчёты твоих добрых дел.</p>'}</div><p class="demo-caption">Демо-профиль. Прогресс хранится только в этом браузере.</p><button class="danger-link" id="reset-demo">Сбросить демо-прогресс</button></div>`,'profile');
  $$('[data-open-issue]').forEach(b=>b.onclick=()=>showIssue(b.dataset.openIssue));
  $$('[data-report-index]').forEach(b=>b.onclick=()=>showSavedReport(Number(b.dataset.reportIndex)));
  $('#reset-demo').onclick=showReset;
}
function showSavedReport(index){
  const report=state.reports[index];if(!report)return;
  sheet(`<div class="sheet-body"><p class="eyebrow">Доброе дело в копилке</p><h2>Твой фотоотчёт</h2><p class="subtext">${new Date(report.created).toLocaleDateString('ru-RU')}</p><div class="report-grid">${['before','after'].map((key,i)=>`<div><p class="form-label" style="margin-top:24px">${i===0?'До':'После'}</p><img src="${esc(report.photos[key])}" alt="${i===0?'До':'После'} уборки" style="width:100%;height:170px;object-fit:cover;border-radius:18px"></div>`).join('')}</div>${report.note?`<p class="detail-description">${esc(report.note)}</p>`:''}<button class="outline-button" id="back-profile">Вернуться в профиль</button></div>`,'profile');
  $('#back-profile').onclick=showProfile;
}
const leaderboardPeople=[
  {id:'anya',name:'Аня Морозова',initials:'АМ',xp:1840,week:450,deeds:12,color:'#ffe0d5'},
  {id:'nikita',name:'Никита Соколов',initials:'НС',xp:1560,week:375,deeds:10,color:'#e0e8ff'},
  {id:'dasha',name:'Даша Волкова',initials:'ДВ',xp:1320,week:300,deeds:9,color:'#e6edcf'},
  {id:'ilya',name:'Илья Кузнецов',initials:'ИК',xp:1130,week:225,deeds:7,color:'#f2def3'},
  {id:'maria',name:'Мария Белова',initials:'МБ',xp:970,week:225,deeds:6,color:'#ffedcd'},
  {id:'max',name:'Макс Орлов',initials:'МО',xp:820,week:150,deeds:5,color:'#d9eeeb'},
  {id:'liza',name:'Лиза Миронова',initials:'ЛМ',xp:710,week:150,deeds:5,color:'#ffe0e6'},
  {id:'artem',name:'Артём Лебедев',initials:'АЛ',xp:560,week:75,deeds:3,color:'#e6e0fb'},
  {id:'sonya',name:'Соня Смирнова',initials:'СС',xp:390,week:75,deeds:2,color:'#dcebd7'}
];
let leaderboardPeriod='week';
function weekStart(){
  const now=new Date();
  // Calendar weeks in Tyumen (UTC+5), independent of the visitor's device timezone.
  const local=new Date(now.getTime()+5*60*60*1000);
  const day=local.getUTCDay()||7;
  return Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-day+1)-5*60*60*1000;
}
function showLeaderboard(period=leaderboardPeriod){
  leaderboardPeriod=period;
  const weekly=period==='week';
  const weekReports=state.reports.filter(r=>r.created>=weekStart());
  const myWeekXP=weekReports.reduce((sum,r)=>sum+(r.type==='event'?150:75),0);
  const me={id:'me',name:'Саша',initials:'С',xp:state.xp,week:myWeekXP,deeds:weekly?weekReports.length:state.reports.length,color:'#e5ebff'};
  const field=weekly?'week':'xp';
  const people=leaderboardPeople.map(p=>({...p,deeds:weekly?Math.ceil(p.week/150):p.deeds}));
  const sorted=[...people,me].sort((a,b)=>b[field]-a[field]||b.deeds-a.deeds||a.id.localeCompare(b.id));
  const rank=sorted.findIndex(p=>p.id==='me')+1;
  const next=sorted[rank-2];
  const gap=next?next[field]-me[field]+1:0;
  const avatarHTML=p=>p.id==='me'?'<span class="rank-avatar avatar avatar-self"></span>':`<span class="rank-avatar" style="background:${p.color}">${p.initials}</span>`;
  const top=sorted.slice(0,3);
  sheet(`<div class="sheet-body leaderboard-body"><p class="eyebrow">Добро заметно</p><h2>Свои на высоте<span class="leaderboard-spark">✳</span></h2><p class="subtext">Тюмень становится лучше благодаря вам.<br>В рейтинге — XP за подтверждённые дела.</p><div class="leaderboard-period" role="group" aria-label="Период рейтинга"><button class="${weekly?'selected':''}" data-period="week" aria-pressed="${weekly}">Эта неделя</button><button class="${weekly?'':'selected'}" data-period="all" aria-pressed="${!weekly}">Всё время</button></div><div class="leaderboard-podium">${[1,0,2].map(i=>{const p=top[i];return `<div class="podium-person podium-${i+1}">${i===0?`<span class="podium-crown">${icon('trophy')}</span>`:''}${avatarHTML(p)}<strong>${esc(p.name.split(' ')[0])}${p.id==='me'?' · ты':''}</strong><span>${p[field].toLocaleString('ru-RU')} XP</span><div class="podium-step"><b>${i+1}</b></div></div>`;}).join('')}</div><div class="your-rank"><span class="your-place">#${rank}</span><div><strong>Твоё место в городе</strong><p>${rank===1?'Ты на вершине. Продолжай делать добро!':`${gap} XP до следующей позиции`}</p></div><b>${me[field]}<small>XP</small></b></div><div class="leaderboard-list-heading"><span>Волонтёр</span><span>${weekly?'XP за неделю':'Всего XP'}</span></div><ol class="leaderboard-list">${sorted.map((p,i)=>`<li class="${p.id==='me'?'is-you':''}"><span class="rank-number">${i+1}</span>${avatarHTML(p)}<span class="rank-name"><strong>${esc(p.name)}${p.id==='me'?'<em>ты</em>':''}</strong><small>${p.deeds} ${deedWord(p.deeds)}</small></span><b class="rank-score">${p[field].toLocaleString('ru-RU')}<small>XP</small></b></li>`).join('')}</ol><div class="leaderboard-nudge">${icon('spark')}<div><strong>В следующий топ — вместе</strong><p>Присоединись к уборке рядом и добавь фотоотчёт.</p></div></div><button class="primary" id="leaderboard-quest">Найти доброе дело ${icon('arrow')}</button><p class="demo-caption">Остальные участники и их баллы — примеры. Твоя позиция рассчитывается по локальному прогрессу. Неделя начинается в понедельник по времени Тюмени.</p></div>`,'leaderboard');
  $$('[data-period]').forEach(b=>b.onclick=()=>showLeaderboard(b.dataset.period));
  $('#leaderboard-quest').onclick=showEvents;
}
function deedWord(count){
  const last=count%10,lastTwo=count%100;
  if(lastTwo>=11&&lastTwo<=14)return 'добрых дел';
  return last===1?'доброе дело':last>=2&&last<=4?'добрых дела':'добрых дел';
}
function showReset(){
  sheet(`<div class="sheet-body"><p class="eyebrow">Начать заново</p><h2>Сбросить прогресс?</h2><p class="subtext">Будут удалены твои локальные отметки, комментарии, фотоотчёты, лайки и XP. Останутся четыре стартовые отметки.</p><button class="primary" id="confirm-reset">Да, сбросить демо</button><button class="outline-button" id="cancel-reset">Сохранить прогресс</button></div>`,'profile');
  $('#cancel-reset').onclick=showProfile;
  $('#confirm-reset').onclick=()=>{state=freshState();draft=null;persist();setFilter('all');updateUI();showProfile();toast('Демо возвращено к началу');};
}
function showSearch(){
  sheet(`<div class="sheet-body"><p class="eyebrow">Присмотрись к городу</p><h2>Что рядом?</h2><input class="text-input search-input" id="search-input" placeholder="Проблема или адрес…" aria-label="Поиск по отметкам"><div class="search-results" id="search-results"></div></div>`);
  const render=()=>{const query=$('#search-input').value.trim().toLowerCase();const items=state.issues.filter(i=>`${i.title} ${i.address} ${issueName(i)}`.toLowerCase().includes(query));$('#search-results').innerHTML=items.map(i=>`<button class="search-result" data-result="${esc(i.id)}">${icon(i.category==='trash'?'trash':'road')}<span><strong>${esc(i.title)}</strong><small>${esc(i.address)} · ${i.likes} лайков${i.resolved?' · решено':''}</small></span>${icon('chevron')}</button>`).join('')||'<p class="empty-state">Такой отметки пока нет. Попробуй другой запрос.</p>';$$('[data-result]').forEach(b=>b.onclick=()=>{const item=state.issues.find(i=>i.id===b.dataset.result);setFilter(item.resolved?'resolved':'all');map?.setView([item.lat,item.lng],16);showIssue(item.id);});};
  $('#search-input').oninput=render;render();setTimeout(()=>$('#search-input')?.focus(),100);
}
function showView(view){
  if(view==='map'){if($('#sheet').open)closeSheet();centerMap();return;}
  if(view==='profile')showProfile();if(view==='team')showTeam();if(view==='events')showEvents();if(view==='leaderboard')showLeaderboard();
}

$('#close-sheet').onclick=closeSheet;
$('#sheet').addEventListener('cancel',()=>{activeSheet='';setNav('map');});
$$('[data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));
$$('[data-filter]').forEach(b=>b.onclick=()=>setFilter(b.dataset.filter));
$('#add-issue').onclick=()=>showAdd();
$('#join-event').onclick=joinEvent;
$('#search-button').onclick=showSearch;
$('#city-button').onclick=()=>{centerMap();toast('Свои в Тюмени. Начинаем с нашего города ♡');};
$('#zoom-in').onclick=()=>map?.zoomIn();
$('#zoom-out').onclick=()=>map?.zoomOut();
$('#locate').onclick=()=>{
  if(!navigator.geolocation){centerMap();toast('Геолокация недоступна. Показываем центр Тюмени');return;}
  toast('Определяем местоположение…');
  navigator.geolocation.getCurrentPosition(pos=>{const point=[pos.coords.latitude,pos.coords.longitude];if(point[0]<56.9||point[0]>57.4||point[1]<65.2||point[1]>65.9){centerMap();toast('Ты пока за пределами Тюмени. Показываем центр');return;}map?.setView(point,16);L.circleMarker(point,{radius:8,color:'white',fillColor:'#2388ff',fillOpacity:1,weight:3}).addTo(map);},()=>{centerMap();toast('Нет доступа к геолокации. Показываем центр Тюмени');},{timeout:8000,maximumAge:60000});
};
initMap();updateUI();
if(storageWarning)setTimeout(()=>toast('Не удалось прочитать сохранение. Открыта стартовая демка'),1000);
