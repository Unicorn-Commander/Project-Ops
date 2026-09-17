"""Isolated fixture browser proof; credentials arrive through stdin only."""
import asyncio,json,sys
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
    fixture=json.load(sys.stdin)
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(channel='chrome',headless=True)
        context=await browser.new_context(viewport={'width':1280,'height':900},permissions=['clipboard-read','clipboard-write'])
        page=await context.new_page()
        await page.goto(fixture['url']+'/auth/workspace-invitation')
        await page.evaluate("""async (token)=>{
          localStorage.setItem('access_token',token);
          const r=await fetch('http://127.0.0.1:55487/api/v1/auth/profile',{headers:{Authorization:'Bearer '+token}});
          if(!r.ok)throw Error('Fixture session rejected');
          localStorage.setItem('user',JSON.stringify(await r.json()));
        }""",fixture['owner'])
        await page.goto(fixture['url']+'/dashboard/settings')
        await page.get_by_role('button',name='Isolated fixture',exact=False).first.click()
        await page.get_by_label('Invited email',exact=True).fill(fixture['email'])
        await page.get_by_role('button',name='Create invitation token',exact=True).click()
        capability=await page.get_by_label('One-time invitation token',exact=True).input_value()
        assert len(capability)==43
        await page.get_by_role('button',name='Copy token',exact=True).click()
        assert await page.evaluate('navigator.clipboard.readText()')==capability
        assert capability not in page.url
        assert capability not in await page.evaluate('JSON.stringify(localStorage)')
        out=Path('/tmp/project-invite-browser');out.mkdir(exist_ok=True)
        await page.get_by_role('region',name='Manual workspace invitation').screenshot(path=str(out/'owner-desktop.png'))
        await page.set_viewport_size({'width':390,'height':844})
        assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        await page.wait_for_timeout(400)
        await page.get_by_role('region',name='Manual workspace invitation').screenshot(path=str(out/'owner-mobile.png'))
        # Keep real HTTP guards: only the isolated signed fixture session changes.
        await page.evaluate('(token)=>{localStorage.clear();localStorage.setItem("access_token",token)}',fixture['invitee'])
        await page.goto(fixture['url']+'/auth/workspace-invitation')
        await page.get_by_label('Invitation token',exact=True).fill(capability)
        async with page.expect_request(lambda r:r.method=='POST' and r.url.endswith('/workspace-invitations/accept')) as sent:
            await page.get_by_role('button',name='Accept invitation',exact=True).click()
        actual=await sent.value
        assert capability not in actual.url and json.loads(actual.post_data)['token']==capability
        await page.get_by_role('status').filter(has_text='Joined Isolated fixture').wait_for()
        assert await page.get_by_label('Invitation token',exact=True).input_value()==''
        assert capability not in page.url and capability not in await page.evaluate('JSON.stringify(localStorage)')
        await page.screenshot(path=str(out/'accepted-mobile.png'),full_page=True)
        await browser.close()
        print('Browser owner copy and invitee acceptance passed; capability stayed out of URL and storage.')
asyncio.run(main())
