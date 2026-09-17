import json,pathlib,os
from playwright.sync_api import sync_playwright
out=pathlib.Path(os.environ.get('PROJECT_OPS_HYDRATION_OUTPUT','/tmp/projectops-workspace-hydration'));out.mkdir(parents=True,exist_ok=True)
workspaces=[{'workspaceId':'real-ws','displayName':'Operator workspace','slug':'operator','role':'OWNER','isDefault':True},{'workspaceId':'demo-ws','displayName':'Rivergreen Synthetic Demo','slug':'demo','role':'OWNER','isDefault':False}]
user={'id':'test-user','email':'operator@fiction.example','firstName':'Demo','lastName':'Operator','role':'ADMIN','workspaces':workspaces}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True);page=browser.new_page(viewport={'width':1440,'height':1000});mode=['normal'];requests=[]
 def route(r):
  path=r.request.url.split('/api/v1')[-1];body=[]
  if path=='/notifications/preferences':body={'email':False,'events':{}}
  elif path=='/time-entries/timer/running':body=None
  elif path=='/notifications/unread-count':body={'count':0}
  elif path=='/auth/profile':body={**user,'workspaces':workspaces if mode[0]=='normal' else workspaces[:1] if mode[0]=='removed' else []}
  elif path=='/auth/pats/scopes':body={'scopes':['read:projects']}
  requests.append({'path':path,'workspace':r.request.headers.get('x-workspace-id')})
  r.fulfill(status=200,json=body,headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'})
 page.route('**/api/v1/**',route)
 page.add_init_script('if(!sessionStorage.getItem("initialized")){sessionStorage.setItem("initialized","yes");localStorage.setItem("access_token","synthetic-test-only");localStorage.setItem("user",'+json.dumps(json.dumps(user))+');localStorage.setItem("projectops.workspaces",'+json.dumps(json.dumps(workspaces))+');localStorage.setItem("projectops.activeWorkspaceId","demo-ws");}')
 page.goto(os.environ.get('PROJECT_OPS_PREVIEW_URL','http://127.0.0.1:55488')+'/dashboard/settings',wait_until='domcontentloaded');page.get_by_label('Switch workspace',exact=True).filter(has_text='Rivergreen').wait_for(timeout=60000)
 page.reload(wait_until='domcontentloaded');page.get_by_label('Switch workspace',exact=True).filter(has_text='Rivergreen').wait_for(timeout=20000)
 assert page.evaluate('localStorage.getItem("projectops.activeWorkspaceId")')=='demo-ws'
 page.screenshot(path=str(out/'workspace-reload-local-20260917.png'),full_page=True)
 mode[0]='removed';page.reload(wait_until='domcontentloaded');page.wait_for_timeout(1500)
 assert page.evaluate('localStorage.getItem("projectops.activeWorkspaceId")')=='real-ws'
 mode[0]='empty';page.reload(wait_until='domcontentloaded');page.wait_for_timeout(1500)
 assert page.evaluate('localStorage.getItem("projectops.activeWorkspaceId")') is None
 # Missing credentials are a genuine logged-out state, unlike initial hydration.
 page.evaluate('localStorage.removeItem("access_token");localStorage.removeItem("user");localStorage.setItem("projectops.activeWorkspaceId","foreign-cache");localStorage.setItem("projectops.workspaces","[]")')
 page.reload(wait_until='domcontentloaded');page.wait_for_timeout(1500)
 assert page.evaluate('localStorage.getItem("projectops.activeWorkspaceId")') is None
 assert page.evaluate('localStorage.getItem("projectops.workspaces")') is None
 result={'test':'actual local frontend; intercepted synthetic API','selected_workspace_survives_reload':True,'removed_workspace_falls_back':True,'zero_memberships_clear_selection':True,'logged_out_state_clears_cache':True,'live_authorization_claim':False}
 (out/'workspace-reload-local-20260917.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));browser.close()
