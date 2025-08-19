#!/usr/bin/env node

/**
 * 切换 Embedding 定时任务模式的脚本
 * 用法：
 *   node scripts/toggleEmbeddingMode.js test    # 切换到测试模式（每分钟执行）
 *   node scripts/toggleEmbeddingMode.js prod    # 切换到生产模式（每天凌晨2点执行）
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env');

function updateEnvFile(mode) {
  try {
    // 读取现有的 .env 文件
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    // 更新或添加 EMBEDDING_TEST_MODE
    const testModeValue = mode === 'test' ? 'true' : 'false';
    const testModeRegex = /^EMBEDDING_TEST_MODE=.*$/m;
    
    if (testModeRegex.test(envContent)) {
      // 更新现有的配置
      envContent = envContent.replace(testModeRegex, `EMBEDDING_TEST_MODE='${testModeValue}'`);
    } else {
      // 添加新的配置
      envContent += `\nEMBEDDING_TEST_MODE='${testModeValue}'\n`;
    }

    // 写回文件
    fs.writeFileSync(envPath, envContent);

    console.log(`✅ 已切换到${mode === 'test' ? '测试' : '生产'}模式`);
    console.log(`📅 定时任务执行频率: ${mode === 'test' ? '每分钟执行一次' : '每天凌晨2点执行'}`);
    console.log(`🔄 请重启定时任务服务以应用新配置`);
    
  } catch (error) {
    console.error('❌ 更新配置文件失败:', error.message);
    process.exit(1);
  }
}

// 解析命令行参数
const args = process.argv.slice(2);
const mode = args[0];

if (!mode || !['test', 'prod'].includes(mode)) {
  console.log('用法:');
  console.log('  node scripts/toggleEmbeddingMode.js test    # 切换到测试模式');
  console.log('  node scripts/toggleEmbeddingMode.js prod    # 切换到生产模式');
  process.exit(1);
}

updateEnvFile(mode);