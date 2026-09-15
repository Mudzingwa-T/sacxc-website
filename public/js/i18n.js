/*!
 * SACXC i18n — language switcher (uses inline #langSwitcher in header.ejs)
 */
(function(){
  const STORE_KEY='sacxc_lang';
  let dict=null, current='en';

  async function loadDict(){
    if(dict)return dict;
    try{
      const r=await fetch('/js/i18n.json',{cache:'force-cache'});
      dict=await r.json();
    }catch(e){dict={langs:{},t:{}};}
    return dict;
  }

  function t(key,lang){
    if(!dict||!dict.t||!dict.t[key])return null;
    return dict.t[key][lang]||dict.t[key].en||null;
  }

  function applyLang(lang){
    current=lang;
    try{localStorage.setItem(STORE_KEY,lang);}catch(e){}
    document.documentElement.lang=lang;
    const info=(dict.langs&&dict.langs[lang])||{dir:'ltr'};
    document.documentElement.dir=info.dir||'ltr';
    if(document.body)document.body.style.direction=info.dir||'ltr';

    document.querySelectorAll('[data-i18n]').forEach(el=>{
      const key=el.getAttribute('data-i18n');
      const val=t(key,lang);
      if(val!==null){
        if(!el.dataset._original)el.dataset._original=el.textContent;
        el.textContent=val;
      }
    });
    document.querySelectorAll('[data-i18n-attr]').forEach(el=>{
      const spec=el.getAttribute('data-i18n-attr');
      spec.split(',').forEach(pair=>{
        const [attr,key]=pair.split(':').map(s=>s.trim());
        if(!attr||!key)return;
        const val=t(key,lang);
        if(val!==null)el.setAttribute(attr,val);
      });
    });

    const flag=document.getElementById('langFlag'),name=document.getElementById('langName');
    if(info.flag&&flag)flag.textContent=info.flag;
    if(info.name&&name)name.textContent=info.name;

    document.querySelectorAll('.lang-item').forEach(it=>{
      it.classList.toggle('active',it.getAttribute('data-lang')===lang);
    });
  }

  function populateMenu(){
    const box=document.getElementById('langSwitcher');if(!box)return;
    const menu=box.querySelector('.lang-menu');if(!menu)return;
    menu.innerHTML='';
    Object.entries(dict.langs||{}).forEach(([code,info])=>{
      const b=document.createElement('button');
      b.type='button';b.className='lang-item';b.setAttribute('data-lang',code);b.setAttribute('role','menuitem');
      b.innerHTML='<span class="lang-flag">'+info.flag+'</span><span class="lang-name">'+info.name+'</span>';
      b.addEventListener('click',()=>{applyLang(code);box.classList.remove('open');});
      menu.appendChild(b);
    });
    const trigger=box.querySelector('.lang-trigger');
    function toggle(){box.classList.toggle('open')}
    trigger.addEventListener('click',e=>{e.stopPropagation();toggle();});
    document.addEventListener('click',e=>{if(!box.contains(e.target))box.classList.remove('open');});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')box.classList.remove('open');});
  }

  async function init(){
    await loadDict();
    if(!dict||!dict.langs||Object.keys(dict.langs).length===0)return;
    populateMenu();
    let saved='en';
    try{saved=localStorage.getItem(STORE_KEY)||'en';}catch(e){}
    if(!saved||!dict.langs[saved]){
      const nav=(navigator.language||'en').slice(0,2).toLowerCase();
      if(dict.langs[nav])saved=nav;else saved='en';
    }
    applyLang(saved);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();

  window.SACXCi18n={setLang:applyLang,get current(){return current;}};
})();
