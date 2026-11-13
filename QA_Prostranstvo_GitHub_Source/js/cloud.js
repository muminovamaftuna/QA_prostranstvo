
/* QA Пространство: облачное сохранение. Публичные настройки, не секреты. */
(function(){
'use strict';
const PROJECT_URL=window.QA_CONFIG.projectUrl;
const PUBLISHABLE_KEY=window.QA_CONFIG.publishableKey;
const AUTH_STORE='qa-cloud-session-v1', PENDING_STORE='qa-cloud-pending-name-v1';
let session=null, profile=null, isAdmin=false, queue=Promise.resolve(), isLoading=false;
const $=id=>document.getElementById(id);
const message=(s,bad=false)=>{const el=$('qa-cloud-msg');el.textContent=s;el.className=bad?'bad':'ok';};
const errorText=e=>{const msg=e?.message||String(e); if(/rate limit|429/i.test(msg))return 'Слишком много запросов. Попробуй позднее.';if(/email not confirmed/i.test(msg))return 'Подтверди свой email.';return msg;};
const saveSession=()=>{if(session){localStorage.setItem(AUTH_STORE,JSON.stringify(session));}else localStorage.removeItem(AUTH_STORE);};
const readSession=()=>{try{const x=JSON.parse(localStorage.getItem(AUTH_STORE)||'null');return x&&typeof x.access_token==='string'&&typeof x.refresh_token==='string'?x:null;}catch{return null;}};
async function request(path,body=null,access=null,method='POST'){
 const headers={'apikey':PUBLISHABLE_KEY,'Content-Type':'application/json'};
 if(access)headers.Authorization='Bearer '+access;
 const resp=await fetch(PROJECT_URL+path,{method,headers,...(body===null?{}:{body:JSON.stringify(body)})});
 const data=await resp.json().catch(()=>null);
 if(!resp.ok)throw new Error(data?.msg||data?.message||data?.error_description||data?.error||('Ошибка запроса HTTP '+resp.status));
 return data;
}
async function refresh(){
 if(!session?.refresh_token)throw new Error('Требуется повторный вход');
 const newer=await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token});
 session={...newer,expires_at:Math.floor(Date.now()/1000)+(newer.expires_in||3600)};saveSession();return session;
}
async function authed(path,body=null,method='POST'){
 if(!session)throw new Error('Сначала войди в профиль');
 if(Date.now()/1000>=(session.expires_at||0)-60)await refresh();
 try{return await request(path,body,session.access_token,method)}catch(e){
 if(/JWT|expired|token.*invalid|401|403/i.test(e.message)){await refresh();return request(path,body,session.access_token,method);}throw e;
 }
}
async function rpc(name,body){return authed('/rest/v1/rpc/'+name,body)}
function renderStatus(){
 const btn=$('qa-cloud-open');if(btn){btn.querySelector('.qa-cloud-pill').textContent=profile?.display_name||'Войти / сохранять';}
 $('qa-cloud-form').hidden=!!session;
 $('qa-cloud-member').hidden=!session;
 $('qa-cloud-member-label').textContent=session?(profile?.display_name||'Профиль')+' · '+(session.user?.email||''):' ';
 $('qa-admin-actions').hidden=!isAdmin;
 if(profile&&document.activeElement!==$('qa-cloud-edit-name'))$('qa-cloud-edit-name').value=profile.display_name;
 $('qa-cloud-status').textContent=session?'Результаты тестов и пройденные уроки сохраняются в Supabase. Заметки остаются на твоём устройстве.':'Войди по email, чтобы сохранять результаты в облаке. Ссылка придёт на почту.';
}
function changeStateForUser(userId){
 const key='qa-cloud-local-'+userId;
 let raw=null;try{raw=JSON.parse(localStorage.getItem(key)||'null')}catch{}
 const originalTheme=state.theme;
 state=normalise(raw);
 state.theme=originalTheme;
 save();render();
}
const originalSave=save;
save=function(){originalSave();try{localStorage.setItem(session?.user?.id?'qa-cloud-local-'+session.user.id:'qa-cloud-anonymous-v1',JSON.stringify(state));}catch{}};
async function loadProfile(){
 if(isLoading)return;isLoading=true;
 try{
  const data=await rpc('qa_load_my_progress',{});
  if(data?.profile){profile=data.profile;const pre=state.theme;changeStateForUser(session.user.id);state.level=data.profile.selected_level||state.level;state.completed=(data.progress||[]).filter(x=>x.completed).map(x=>x.lesson_id).filter(x=>BY_ID[x]);
    for(const a of (data.attempts||[])){if(!BY_ID[a.lesson_id])continue;state.quizzes[a.lesson_id]={answers:a.answers,score:a.score,max:a.max_score,bestScore:(data.progress||[]).find(p=>p.lesson_id===a.lesson_id)?.best_score??a.score,date:a.created_at};}
    state.theme=pre;save();render();
  }else{
   profile=null;const name=(sessionStorage.getItem(PENDING_STORE)||'').trim()||'Ученик';
   profile=await rpc('qa_save_profile',{p_display_name:name,p_selected_level:state.level});
   sessionStorage.removeItem(PENDING_STORE);changeStateForUser(session.user.id);
  }
  isAdmin=!!(await rpc('qa_is_admin',{}));
  renderStatus();message('Профиль подключён. Результаты новых тестов будут сохраняться в облаке.');
 }catch(e){renderStatus();message('Не удалось загрузить данные: '+errorText(e),true)}finally{isLoading=false;}
}
async function finishLogin(newSession){
 if(!newSession?.access_token||!newSession?.refresh_token)throw new Error('Ссылка для входа недействительна');
 session={...newSession,expires_at:Math.floor(Date.now()/1000)+(newSession.expires_in||3600)};saveSession();
 try{const user=await authed('/auth/v1/user',null,'GET');session.user=user;saveSession()}catch(e){throw new Error('Не удалось получить профиль: '+errorText(e))}
 await loadProfile();
}
async function startup(){
 // Supabase magic link возвращает access_token в адресной строке после #.
 const h=location.hash.slice(1);const params=new URLSearchParams(h);
 if(params.has('access_token')&&params.has('refresh_token')){
   const access_token=params.get('access_token'),refresh_token=params.get('refresh_token'),expires_in=Number(params.get('expires_in')||3600);
   history.replaceState(null,'',location.pathname+location.search+'#home');
   try{await finishLogin({access_token,refresh_token,expires_in})}catch(e){message(errorText(e),true)}
 }else if(params.get('error_description')){
   const err=params.get('error_description');history.replaceState(null,'',location.pathname+location.search+'#home');message(err,true);
 }else{
   session=readSession();if(session){
     try{if(Date.now()/1000>=(session.expires_at||0)-60)await refresh();const u=await authed('/auth/v1/user',null,'GET');session.user=u;saveSession();await loadProfile()}catch(e){session=null;saveSession();message('Сессия истекла. Войди снова.',true)}
   }
 }
 renderStatus();
}
$('qa-cloud-close').addEventListener('click',()=>$('qa-cloud-dialog').close());
$('qa-cloud-form').addEventListener('submit',async ev=>{
 ev.preventDefault();const name=$('qa-cloud-name').value.trim(),email=$('qa-cloud-email').value.trim().toLowerCase();
 if(!name||name.length>80)return message('Укажи имя до 80 символов.',true);
 const btn=$('qa-cloud-submit');btn.disabled=true;sessionStorage.setItem(PENDING_STORE,name);
 try{await request('/auth/v1/otp?redirect_to='+encodeURIComponent(location.origin+location.pathname),{email,create_user:true});
 message('Проверь почту и перейди по ссылке входа. Если письмо не пришло, проверь «Спам».');}
 catch(e){message('Не удалось отправить письмо: '+errorText(e),true)}finally{btn.disabled=false}
});
$('qa-cloud-signout').addEventListener('click',async()=>{
 try{await authed('/auth/v1/logout',{},'POST')}catch{}
 session=null;profile=null;isAdmin=false;saveSession();state=defaults();originalSave();render();renderStatus();message('Ты вышла из профиля. Для сохранения результатов войди снова.');
});
$('qa-cloud-save-name').addEventListener('click',async()=>{const n=$('qa-cloud-edit-name').value.trim();if(!n||n.length>80)return message('Имя должно содержать от 1 до 80 символов.',true);try{profile=await rpc('qa_save_profile',{p_display_name:n,p_selected_level:state.level});renderStatus();message('Имя сохранено в базе.')}catch(e){message(errorText(e),true)}});
$('qa-cloud-sync').addEventListener('click',()=>loadProfile());
$('qa-cloud-students').addEventListener('click',async()=>{
 if(!isAdmin)return;const el=$('qa-cloud-admin-results');el.textContent='Загружаю результаты…';
 try{
 const [students,progress,attempts]=await Promise.all([
  authed('/rest/v1/qa_profiles?select=user_id,display_name,selected_level,last_seen_at&order=last_seen_at.desc',null,'GET'),
  authed('/rest/v1/qa_lesson_progress?select=user_id,completed,lesson_id',null,'GET'),
  authed('/rest/v1/qa_quiz_attempts?select=user_id,lesson_id,score,max_score,created_at&order=created_at.desc&limit=1000',null,'GET')
 ]);
 const table=document.createElement('table');table.className='qa-admin-table';
 table.innerHTML='<thead><tr><th>Имя</th><th>Уровень</th><th>Уроки</th><th>Тесты</th><th>Активность</th></tr></thead>';
 const tbody=document.createElement('tbody');
 for(const s of students){const p=progress.filter(x=>x.user_id===s.user_id&&x.completed);const a=attempts.filter(x=>x.user_id===s.user_id);const last=a[0];const tr=document.createElement('tr');
   for(const v of [s.display_name,s.selected_level,String(p.length)+' / 27',a.length+(last?' · последний '+last.score+'/'+last.max_score:''),s.last_seen_at?new Date(s.last_seen_at).toLocaleDateString('ru-RU'):'—']){
    const td=document.createElement('td');td.textContent=v;tr.append(td);
   }tbody.append(tr);
 }table.append(tbody);el.replaceChildren(table);
 }catch(e){el.textContent='Ошибка загрузки учеников: '+errorText(e)}
});
// Не отправляем в базу заметки или черновики. Только ответы и завершение урока.
function enqueue(task){queue=queue.then(task).catch(e=>{message('Не удалось сохранить в облако: '+errorText(e)+'. Локальная копия сохранена.',true)});}
document.addEventListener('submit',ev=>{
 if(ev.target.id!=='quiz-form'||!session||!profile)return;
 const id=ev.target.dataset.lessonId;
 // Обработчик самого курса уже посчитал локальный результат.
 queueMicrotask(()=>{const q=state.quizzes[id];if(!q||q.answers.includes(-1))return;
  const attemptId=crypto.randomUUID();const answers=[...q.answers];
  enqueue(async()=>{const remote=await rpc('qa_submit_attempt',{p_attempt_id:attemptId,p_lesson_id:id,p_answers:answers});
    if(state.quizzes[id]){state.quizzes[id].score=remote.score;state.quizzes[id].max=remote.max_score;save();}
    message('Тест сохранён в базе: '+remote.score+'/'+remote.max_score);
  });
 });
});
document.addEventListener('click',ev=>{
 const target=ev.target.closest('[data-action="complete"]');if(!target||!session||!profile)return;
 const id=target.dataset.id, q=state.quizzes[id];
 if(!q||q.bestScore!==q.max)return;
 enqueue(async()=>{await rpc('qa_complete_lesson',{p_lesson_id:id});message('Урок '+id+' сохранён в базе данных.');});
});
const action=document.createElement('button');action.id='qa-cloud-open';action.className='qa-cloud-action';action.type='button';action.innerHTML='<span aria-hidden="true">☁</span><span class="qa-cloud-pill">Войти / сохранять</span>';
(document.querySelector('.topbar-actions')||document.querySelector('header')).prepend(action);
action.addEventListener('click',()=>{$('qa-cloud-dialog').showModal();renderStatus();});
window.qaCloud={open:()=>{$('qa-cloud-dialog').showModal();renderStatus();}};
startup();
})();
