const fs = require('fs');
const path = require('path');

const mainCssPath = path.join(__dirname, '../src/renderer/css/main.css');
const componentsCssPath = path.join(__dirname, '../src/renderer/css/components.css');
const pagesCssPath = path.join(__dirname, '../src/renderer/css/pages.css');

let content = fs.readFileSync(mainCssPath, 'utf8');

const sectionsToPages = [
  '截图与活动页面',
  '更新中心',
  '设置页',
  '关于页',
  '更新源输入框'
];

const sectionsToComponents = [
  '隐私规则弹窗',
  '截图预览头部',
  'configModal',
  '认证弹窗',
  '密钥接管弹窗',
  '首次引导弹窗',
  '小组件编辑模式'
];

let pagesCss = '/* Pages CSS */\n';
let componentsCss = '/* Components CSS */\n';
let legacyCss = '/* Legacy CSS (To be further refactored) */\n';

const blocks = content.split(/(?=\/\*\s*=+[^=]*=+\s*\*\/)/);

for (const block of blocks) {
  let matched = false;

  for (const p of sectionsToPages) {
    if (block.includes(p)) {
      pagesCss += block + '\n';
      matched = true;
      break;
    }
  }

  if (!matched) {
    for (const c of sectionsToComponents) {
      if (block.includes(c)) {
        componentsCss += block + '\n';
        matched = true;
        break;
      }
    }
  }

  if (!matched) {
    legacyCss += block + '\n';
  }
}

// We also have tokens, base, layout which are already pulled out by user.
// Since the legacy main.css still has :root and html[data-theme="light"], we might want to strip those if they are exactly in tokens.css, but let's keep it safe.

fs.writeFileSync(path.join(__dirname, '../src/renderer/css/legacy.css'), legacyCss, 'utf8');
fs.writeFileSync(pagesCssPath, pagesCss, 'utf8');
fs.writeFileSync(componentsCssPath, componentsCss, 'utf8');

const newMainCss = `@import url('./tokens.css');
@import url('./base.css');
@import url('./layout.css');
@import url('./components.css');
@import url('./pages.css');
@import url('./legacy.css');

/* main.css is now just a router */
`;

fs.writeFileSync(mainCssPath, newMainCss, 'utf8');
console.log('CSS split completed.');
