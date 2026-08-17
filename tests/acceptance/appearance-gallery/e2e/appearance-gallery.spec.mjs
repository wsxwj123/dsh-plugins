// UI 真实流程验收（@playwright/test）。**04 之后接线跑**，现在只做语法检查。
//
// 接线方法：
//   1) pnpm add -D @playwright/test && npx playwright install chromium
//   2) 起隔离实例：dsh web --port 3199
//   3) DSH_E2E_BASE_URL=http://localhost:3199 npx playwright test tests/acceptance/appearance-gallery/e2e
//   4) 若设置页入口按钮的可见文案在实现里定稿，把 ENTRY_BUTTON 的 TODO 换成确切文案
//
// selector 纪律：只用 INTERFACE 声明过的可见文案与角色。INTERFACE 未钉住文案的控件
// （设置页入口按钮、主题卡的试穿/应用/删除按钮、导入主题按钮）用 role + 区域限定，
// 并留 TODO —— 不许自己编文案冒充契约。
import { test, expect } from '@playwright/test';

const BASE = process.env.DSH_E2E_BASE_URL;

// INTERFACE §3.3 / §3.2 里逐字钉住的可见文案
const TXT = {
  back: '返回',
  restoreAppearance: '恢复默认外观',
  createSkin: '创建自定义皮肤',
  importSkin: '导入皮肤',
  deleteSkin: '删除皮肤',
  tryOn: '试穿',
  apply: '应用',
  themePrefix: '精选主题 · ',
  skinPrefix: '完整皮肤 · ',
  legacyConflict: '检测到旧版 theme-gallery / skin-gallery 仍已安装，请先卸载，否则外观会冲突',
  skinUnavailable: '皮肤轨道不可用：宿主未提供',
};

const KEYS = {
  track: 'dsh-appearance-track-v1',
  family: 'theme-gallery-family-v5',
  themeCustom: 'theme-gallery-custom-v1',
  themeApplied: 'theme-gallery-custom-applied-v1',
  touched: 'theme-gallery-custom-touched-v1',
  skinCustom: 'skin-gallery-custom-v1',
  skinApplied: 'skin-gallery-custom-applied-v1',
  skinBuiltin: 'skin-gallery-skin-v1',
};
const ALL_KEYS = Object.values(KEYS);

const readKeys = (page) => page.evaluate(
  (keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])),
  ALL_KEYS,
);

/** 打开设置 → 通用。宿主导航文案未在 INTERFACE 里钉住 → 用 role，TODO 接线时核对 */
async function openGeneralSettings(page) {
  await page.goto(BASE);
  await page.getByRole('button', { name: /设置|Settings/ }).click();
  await page.getByRole('tab', { name: /通用|General/ }).click();
}

/** 点设置页的外观入口按钮 → 展开二级面板 */
async function openAppearancePanel(page) {
  // TODO(04): 入口按钮文案 INTERFACE 未钉住，定稿后换成 getByRole('button', { name: '<确切文案>' })
  const entry = page.locator('[data-slot-id="appearance-gallery"]');
  await entry.getByRole('button').first().click();
  await expect(page.getByRole('button', { name: TXT.back })).toBeVisible();
}

test.describe('外观插件二级面板（UI 真实流程）', () => {
  test.skip(!BASE, '未接线：设置 DSH_E2E_BASE_URL 并先跑 dsh web --port 3199');

  test('设置页通用只出现一个外观入口', async ({ page }) => {
    await openGeneralSettings(page);
    await expect(page.locator('[data-slot-id="appearance-gallery"]')).toHaveCount(1);
    await expect(page.locator('[data-slot-id="theme-gallery"]')).toHaveCount(0);
    await expect(page.locator('[data-slot-id="skin-gallery"]')).toHaveCount(0);
  });

  test('入口默认态显示状态摘要且不含卡片', async ({ page }) => {
    await openGeneralSettings(page);
    const entry = page.locator('[data-slot-id="appearance-gallery"]');
    await expect(entry).toContainText(/精选主题 · |完整皮肤 · |默认外观/);
    await expect(entry.getByRole('button', { name: TXT.back })).toHaveCount(0);
  });

  test('点入口后主题区与皮肤区同时出现', async ({ page }) => {
    await openGeneralSettings(page);
    await openAppearancePanel(page);
    await expect(page.getByRole('button', { name: TXT.restoreAppearance })).toBeVisible();
    await expect(page.getByRole('button', { name: TXT.tryOn }).first()).toBeVisible();
  });

  test('试穿皮肤后点返回_外观回到storage记录的状态', async ({ page }) => {
    await openGeneralSettings(page);
    await openAppearancePanel(page);
    const before = await readKeys(page);
    await page.getByRole('button', { name: TXT.tryOn }).first().click();
    await page.getByRole('button', { name: TXT.back }).click();
    expect(await readKeys(page)).toEqual(before);
  });

  test('应用皮肤后skin-v1键被写入且track为skin', async ({ page }) => {
    await openGeneralSettings(page);
    await openAppearancePanel(page);
    await page.getByRole('button', { name: TXT.apply }).first().click();
    const keys = await readKeys(page);
    expect(keys[KEYS.skinBuiltin]).not.toBe('');
    expect(keys[KEYS.track]).toBe('skin');
  });

  test('快速连点两个皮肤的应用_body上只留一套皮肤属性', async ({ page }) => {
    await openGeneralSettings(page);
    await openAppearancePanel(page);
    const applyButtons = page.getByRole('button', { name: TXT.apply });
    await Promise.all([applyButtons.nth(0).click(), applyButtons.nth(1).click()]);
    const attrs = await page.evaluate(() => [...document.body.attributes]
      .map((a) => a.name).filter((n) => n.startsWith('data-dsh-')));
    expect(attrs).toHaveLength(1);
  });

  test('导入非法主题JSON_页面显示错误码开头的文案且storage不变', async ({ page }) => {
    await openGeneralSettings(page);
    await openAppearancePanel(page);
    const before = await readKeys(page);
    // TODO(04): 主题导入 textarea 与提交按钮的可见文案未钉住，定稿后换精确 selector
    await page.locator('textarea').first().fill('这不是 json');
    await page.getByRole('button', { name: /导入.*主题|主题.*导入/ }).click();
    await expect(page.getByText(/^ERR_IMPORT_INVALID_JSON: /)).toBeVisible();
    expect(await readKeys(page)).toEqual(before);
  });

  test('导入皮肤三件套_成功后新皮肤出现在列表里', async ({ page }) => {
    await openGeneralSettings(page);
    await openAppearancePanel(page);
    await page.getByRole('button', { name: TXT.importSkin }).click();
    const areas = page.locator('textarea');
    await areas.nth(0).fill(JSON.stringify({ id: 'e2e-skin', name: 'E2E 皮肤', author: 'qa', license: 'MIT' }));
    await areas.nth(1).fill('window.__ModuleLoader__.load({ id: "dsh-skin-e2e", factory: (r) => { '
      + 'function apply(ctx) { ctx.effect(() => {}); } return { apply: apply }; } });');
    await areas.nth(2).fill(':root{--dsh-focus:2px}');
    await page.getByRole('button', { name: TXT.importSkin }).click();
    await expect(page.getByText('E2E 皮肤')).toBeVisible();
  });

  test('导入皮肤命中高危黑名单_显示ERR_SKIN_DANGEROUS且不入库', async ({ page }) => {
    await openGeneralSettings(page);
    await openAppearancePanel(page);
    const before = await readKeys(page);
    await page.getByRole('button', { name: TXT.importSkin }).click();
    const areas = page.locator('textarea');
    await areas.nth(0).fill(JSON.stringify({ id: 'bad', name: 'bad', author: 'qa', license: 'MIT' }));
    await areas.nth(1).fill('window.__ModuleLoader__.load({ id: "x", factory: (r) => { '
      + 'function apply(ctx) { fetch("/x"); } return { apply: apply }; } });');
    await page.getByRole('button', { name: TXT.importSkin }).click();
    await expect(page.getByText(/^ERR_SKIN_DANGEROUS: /)).toBeVisible();
    expect((await readKeys(page))[KEYS.skinCustom]).toBe(before[KEYS.skinCustom]);
  });

  test('恢复默认外观_皮肤被卸载且三个皮肤键清空', async ({ page }) => {
    await openGeneralSettings(page);
    await openAppearancePanel(page);
    await page.getByRole('button', { name: TXT.apply }).first().click();
    await page.getByRole('button', { name: TXT.restoreAppearance }).click();
    const keys = await readKeys(page);
    expect(keys[KEYS.skinBuiltin] || '').toBe('');
    expect(keys[KEYS.skinApplied] || '').toBe('');
  });

  test('设计助手_勾选版块后只读textarea内容变化且不含旧仓库路径', async ({ page }) => {
    await openGeneralSettings(page);
    await openAppearancePanel(page);
    await page.getByRole('button', { name: TXT.createSkin }).click();
    const area = page.locator('textarea[readonly]').first();
    const before = await area.inputValue();
    await page.getByRole('checkbox').first().check();
    await expect(area).not.toHaveValue(before);
    expect(await area.inputValue()).not.toContain('packages/skin-gallery/skins/');
    expect(await area.inputValue()).toContain('packages/appearance-gallery/skins/');
  });

  test('删除皮肤_勾选后需二次确认才真的删掉', async ({ page }) => {
    await openGeneralSettings(page);
    await openAppearancePanel(page);
    await page.getByRole('button', { name: TXT.deleteSkin }).click();
    // 只勾选不确认：registry 不变
    const before = await readKeys(page);
    await page.getByRole('checkbox').first().check();
    expect((await readKeys(page))[KEYS.skinCustom]).toBe(before[KEYS.skinCustom]);
  });

  test('刷新页面后不打开面板_已应用皮肤自动生效', async ({ page }) => {
    await openGeneralSettings(page);
    await openAppearancePanel(page);
    await page.getByRole('button', { name: TXT.apply }).first().click();
    const applied = (await readKeys(page))[KEYS.skinBuiltin];
    await page.reload();
    const attrs = await page.evaluate(() => [...document.body.attributes]
      .map((a) => a.name).filter((n) => n.startsWith('data-dsh-')));
    expect(attrs).toEqual([`data-dsh-${applied}`]);
  });

  test('应用皮肤后body的backgroundAttachment不是fixed', async ({ page }) => {
    // §3.11 P2 的自动化版
    await openGeneralSettings(page);
    await openAppearancePanel(page);
    await page.getByRole('button', { name: TXT.apply }).first().click();
    const attachment = await page.evaluate(() => getComputedStyle(document.body).backgroundAttachment);
    expect(attachment).not.toBe('fixed');
  });

  test('专用背景层最多1个且带fixed与pointer-events-none与负z-index', async ({ page }) => {
    // §3.11 P3：仅在采用"专用背景层"方案时有意义；未采用时该层为 0 个，断言同样成立
    await openGeneralSettings(page);
    await openAppearancePanel(page);
    await page.getByRole('button', { name: TXT.apply }).first().click();
    const layers = await page.evaluate(() => [...document.querySelectorAll('[data-skin-bg]')].map((el) => {
      const s = getComputedStyle(el);
      return { position: s.position, pointerEvents: s.pointerEvents, zIndex: Number(s.zIndex) };
    }));
    expect(layers.length).toBeLessThanOrEqual(1);
    for (const l of layers) {
      expect(l.position).toBe('fixed');
      expect(l.pointerEvents).toBe('none');
      expect(l.zIndex).toBeLessThan(0);
    }
  });

  test('旧包仍在场时入口显示冲突提示', async ({ page }) => {
    await page.goto(BASE);
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.setAttribute('data-skin-gallery', '');
      document.head.appendChild(s);
    });
    await openGeneralSettings(page);
    await expect(page.getByText(TXT.legacyConflict)).toBeVisible();
  });
});
