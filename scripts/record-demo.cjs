// Optional tooling: NODE_PATH=/path/to/playwright/node_modules node scripts/record-demo.cjs
// Records the real components with isolated sample data; no Trello account is used.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'img/demo');

async function fixture(page, scene) {
  await page.evaluate(({ scene }) => {
    const settings = { hoursPerDay: 8, daysPerWeek: 5, daysPerMonth: 20, weekStartsOn: 1 };
    const today = new Date(), ymd = TimeDuration.formatYmd(today), dateKey = Number(ymd.replaceAll('-', ''));
    const members = [{ id: 'alex', name: 'Alex Morgan' }, { id: 'sam', name: 'Sam Taylor' }];
    const entry = (id, minutes, member = members[0], note = '') => ({ id, minutes, ymd: dateKey, memberId: member.id, memberName: member.name, note, createdAt: Date.now() });
    const card = (id, name, limitMinutes, entries = [], kids = []) => ({ id, name, limitMinutes, entries, kids, linkedIds: kids, url: 'https://trello.com/c/' + id, labels: [], listName: 'In progress' });
    const cards = [
      card('launch', 'Website launch', 2400, [], ['design', 'build']),
      card('design', 'Design the onboarding flow', 960, [entry('design-1', 360, members[0], 'Wireframes and user flow')]),
      card('build', 'Build the customer portal', 1920, [entry('build-1', 240, members[1], 'API integration')]),
      card('qa', 'Test and release', 480, [entry('qa-1', 90, members[0], 'Regression checks')])
    ];
    cards[0].labels = [{ id: 'launch', name: 'Launch', color: 'purple' }];
    cards[1].labels = [{ id: 'design', name: 'Design', color: 'pink' }];
    cards[2].labels = cards[3].labels = [{ id: 'engineering', name: 'Engineering', color: 'blue' }];
    cards[2].dependencyIds = ['design']; cards[3].dependencyIds = ['build'];
    const titles = {
      time: ['Log time as you work', 'Add a duration, leave a note, and keep a clear history on every card.'],
      epics: ['Bring tasks together', 'Link child cards and track their logged time against an epic estimate.'],
      timeline: ['Plan around real capacity', 'See dependencies, logged progress and your team’s available FTE.'],
      reports: ['Turn time into a clear report', 'Filter by label or author, then download the results as an Excel workbook.']
    };
    document.documentElement.setAttribute('data-color-mode', 'light');
    document.body.replaceChildren();
    document.body.className = 'page trello-power-up';
    const h = TimeDom.h;
    document.body.appendChild(h('header', { class: 'demo-header' }, [h('div', { class: 'demo-brand' }, '◷  Time Tracking'), h('div', { class: 'demo-label' }, 'LOCAL DEMO · SAMPLE DATA')]));
    document.body.appendChild(h('section', { class: 'demo-intro' }, [h('h1', null, titles[scene][0]), h('p', null, titles[scene][1])]));
    const host = h('main', { class: 'demo-host demo-' + scene }); document.body.appendChild(host);
    const toast = h('div', { class: 'demo-toast', role: 'status', hidden: true }); document.body.appendChild(toast);
    const cursor = h('div', { class: 'demo-cursor', 'aria-hidden': 'true' }); document.body.appendChild(cursor);
    document.addEventListener('mousemove', event => { cursor.style.left = event.clientX + 'px'; cursor.style.top = event.clientY + 'px'; });
    const notify = text => { toast.textContent = text; toast.hidden = false; };
    if (scene === 'time' || scene === 'epics') {
      const selected = scene === 'epics' ? cards[0] : cards[1];
      if (scene === 'epics') { selected.kids = ['design']; selected.linkedIds = selected.kids; }
      host.appendChild(h('div', { class: 'demo-card-heading' }, [h('small', null, 'CARD · IN PROGRESS'), h('h2', null, selected.name)]));
      const panel = h('div', { class: 'panel' }); host.appendChild(panel);
      let view;
      const paint = () => view.update({
        cardId: selected.id, settings, members, currentMemberId: 'alex', canWrite: true, canAdd: true,
        entries: TimeModel.sortEntries(selected.entries), limitMinutes: selected.limitMinutes, linkedIds: selected.kids,
        kidsKnown: true, storageRatio: 0.05, warning: '', error: '', limitError: '', saving: false,
        dependencies: [], inheritedDependencies: [], planning: {},
        children: selected.kids.map(id => { const child = cards.find(c => c.id === id); return { id, name: child.name, url: child.url, minutes: TimeModel.totalMinutes(child.entries) }; })
      });
      view = TimeCardView.mount(panel, {
        today: () => today, settings: () => settings, canAuthorize: false,
        onAdd: async fields => { selected.entries.push(entry('new-' + selected.entries.length, fields.minutes, members[0], fields.note)); paint(); },
        onUpdate: async fields => { Object.assign(selected.entries.find(e => e.id === fields.id), fields); paint(); },
        onDelete: async id => { selected.entries = selected.entries.filter(e => e.id !== id); paint(); },
        onPlanning: async (planning, minutes) => { selected.planning = planning; selected.limitMinutes = minutes; paint(); },
        onCardSearch: async query => cards.filter(c => c.id !== selected.id && !selected.kids.includes(c.id) && c.name.toLowerCase().includes(query.toLowerCase())),
        onLinkAdd: async (text, id) => { const child = cards.find(c => id ? c.id === id : c.name === text); selected.kids.push(child.id); paint(); },
        onLinkRemove: async id => { selected.kids = selected.kids.filter(k => k !== id); paint(); },
        onLinkReorder: async ids => { selected.kids = ids; paint(); },
        onInspectDependencies: async () => ({ count: 0, incomplete: false }), onTimeline: () => {}, onAuthorize: async () => {}
      }); paint();
    } else if (scene === 'timeline') {
      cards[0].kids.push('qa'); cards[0].limitMinutes = null;
      cards[1].limitMinutes = 3360; cards[2].limitMinutes = 4800; cards[3].limitMinutes = 1440;
      let model = { cards, settings, calendar: { baseFte: 1, changes: [] }, canWrite: true };
      const view = TimeTimelineView.mount(host, { start: ymd, rootId: 'launch', onRefresh: async () => view.update(model), onCalendar: async calendar => { model.calendar = calendar; view.update(model); } });
      view.update(model);
    } else {
      let view;
      const paint = () => view.update(TimeAggregate.buildReport(cards, view.filters()), '');
      view = TimeReportView.mount(host, { today: () => today, settings: () => settings, onChange: paint, onExport: () => {
        const report = TimeAggregate.buildReport(cards, view.filters()); report.labelText = TimeAggregate.labelText;
        TimeDom.download('time-report.xlsx', TimeExcel.buildWorkbook(report, TimeDuration.formatDuration, settings));
        notify('Excel workbook downloaded · Report, Entries & Epics');
      } }); paint();
    }
  }, { scene });
  await page.addStyleTag({ content: `
    * { animation:none !important; scroll-behavior:auto !important; }
    body { margin:0; padding:0; background:#f4f7fc; color:#172b4d; }
    .demo-header { height:62px; padding:0 34px; display:flex; justify-content:space-between; align-items:center; background:#fff; border-top:4px solid #0c66e4; border-bottom:1px solid #dce3ed; }
    .demo-brand { font-size:19px; font-weight:700; letter-spacing:-.4px; }
    .demo-label { font-size:10px; color:#626f86; letter-spacing:1px; }
    .demo-intro { padding:24px 34px 18px; }
    .demo-intro h1 { margin:0 0 8px; font-size:28px; letter-spacing:-.7px; }
    .demo-intro p { margin:0; color:#626f86; font-size:14px; }
    .demo-host { margin:0 28px; padding:20px; background:#fff; border:1px solid #dce3ed; border-radius:12px; box-shadow:0 8px 24px #172b4d09; }
    .demo-time, .demo-epics { width:740px; margin:0 auto; }
    .demo-card-heading { margin-bottom:16px; }
    .demo-card-heading small { color:#626f86; font-size:10px; letter-spacing:1px; }
    .demo-card-heading h2 { margin:6px 0 0; font-size:20px; }
    .demo-host .panel { border:0; box-shadow:none; padding:0; }
    .demo-timeline { padding:16px; }
    .demo-timeline .timeline-heading { margin-bottom:12px; }
    .demo-timeline .timeline-heading h1 { font-size:17px; }
    .demo-timeline .timeline-note { display:none; }
    .demo-timeline .timeline-summary { margin:12px 0 8px; }
    .demo-timeline .timeline-calendar { padding:8px 12px; }
    .demo-timeline .timeline-calendar form { padding-top:6px; }
    .demo-cursor { position:fixed; z-index:200; width:14px; height:14px; border:2px solid #fff; border-radius:50%; background:#172b4d; box-shadow:0 0 0 5px #0c66e425; pointer-events:none; left:1120px; top:730px; }
    .demo-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); padding:13px 22px; background:#164b35; color:#fff; border-radius:8px; font-size:14px; box-shadow:0 4px 18px #172b4d30; }
    .demo-toast[hidden] { display:none; }
  ` });
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scene of process.argv.length > 2 ? process.argv.slice(2) : ['time', 'epics', 'timeline', 'reports']) {
      const context = await browser.newContext({ viewport: { width: 1200, height: 850 }, deviceScaleFactor: 1, recordVideo: { dir: '/tmp/time-tracking-demo-video', size: { width: 1200, height: 850 } }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.route('http://demo.local/**', async route => {
        const url = new URL(route.request().url()), file = path.join(root, url.pathname.slice(1));
        try { await route.fulfill({ body: await fs.readFile(file), contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] }); }
        catch { await route.fulfill({ status: 404 }); }
      });
      await page.goto('http://demo.local/preview.html');
      await page.waitForSelector('.timeline-bar');
      await fixture(page, scene);
      const hold = ms => page.waitForTimeout(ms);
      const click = async locator => { await locator.hover(); await hold(350); await locator.click(); await hold(650); };
      const type = async (locator, text) => { await click(locator); await locator.fill(''); await locator.pressSequentially(text, { delay: 110 }); await hold(650); };
      await hold(1700);
      if (scene === 'time') {
        await click(page.getByRole('tab', { name: 'Task', exact: true }));
        await type(page.getByRole('textbox', { name: 'Time', exact: true }), '1h 30m');
        await type(page.getByRole('textbox', { name: 'Comment', exact: true }), 'Prototype review');
        await click(page.getByRole('button', { name: 'Add time', exact: true }));
        await hold(2200);
        if (!await page.getByText('Prototype review', { exact: true }).isVisible()) throw new Error('Time entry did not save');
      } else if (scene === 'epics') {
        await click(page.getByRole('button', { name: '+ add child card', exact: true }));
        await type(page.getByRole('combobox', { name: 'Child card name or link' }), 'customer');
        await click(page.getByRole('option').filter({ hasText: 'Build the customer portal' }));
        await click(page.locator('#child-card-form').getByRole('button', { name: 'Add', exact: true }));
        await hold(2200);
        if (!await page.locator('.epic-body').getByText('Build the customer portal', { exact: true }).isVisible()) throw new Error('Child was not linked');
      } else if (scene === 'timeline') {
        const before = await page.locator('.timeline-summary').innerText();
        await click(page.locator('.timeline-bar[aria-label^="Build the customer portal"]'));
        await hold(1600); await page.keyboard.press('Escape');
        await click(page.locator('.timeline-calendar > summary'));
        await type(page.getByRole('spinbutton', { name: 'Default FTE', exact: true }), '2');
        await click(page.getByRole('button', { name: 'Save FTE calendar' }));
        await click(page.locator('.timeline-calendar > summary'));
        await page.evaluate(() => window.scrollTo(0, 0));
        if (before === await page.locator('.timeline-summary').innerText()) throw new Error('FTE change did not update forecast');
        await hold(2200);
      } else {
        await click(page.getByRole('button', { name: 'Engineering', exact: true }));
        await hold(1400);
        await click(page.getByRole('button', { name: 'Sam Taylor', exact: true }));
        await hold(1400);
        const downloadPromise = page.waitForEvent('download');
        await click(page.getByRole('button', { name: 'Download Excel', exact: true }));
        const download = await downloadPromise;
        await download.saveAs(path.join(output, 'sample-time-report.xlsx'));
        await hold(1800);
      }
      await page.mouse.move(1140, 800, { steps: 12 });
      await page.screenshot({ path: path.join(output, scene + '.png') });
      await hold(1000);
      if (errors.length) throw new Error(scene + ': ' + errors.join('; '));
      const video = page.video(); await context.close();
      const videoPath = await video.path();
      const mp4 = path.join(output, scene + '.mp4');
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.5', '-i', videoPath, '-an', '-vf', 'fps=20', '-c:v', 'libx264', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-filter_complex', 'fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle', '-loop', '0', path.join(output, scene + '.gif')]);
      console.log(scene + ': recorded, verified, GIF + MP4 + PNG exported');
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
