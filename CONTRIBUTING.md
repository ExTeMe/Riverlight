# 参与 Riverlight 开发

从 [工作流程](docs/GIT_WORKFLOW.md) 与 GitHub 当前任务开始；首次进入完整读规范，续作按任务补读章节与变化。执行规则以工作流程为准。

选择范围与验收明确的 Issue，认领并收到成功回执后在任务分支实现，首批可审查改动建立目标 dev 的 Draft PR。可用 npm run workflow 生成认领、资源更新和交接评论，由已连接工具提交；详见工作流程“认领、隔离和交接”。

按改动执行检查：纯文档运行 npm run check:privacy、npm run check:docs，并复核文字/链接；管理修改补充 node --test tests/github-*.test.js tests/ci.test.js tests/workflow-command.test.js tests/check-docs.test.js；城市功能、资产、依赖和未知影响运行 npm test、npm run build 与 npm run test:browser。首次浏览器回归安装 npx playwright install chromium。相关报告由 CI 保存，不提交本地日志。

交付经当前版本审查与检查集成到 dev，再按任务标准验收。验收准备由管理工作流生成，确认后自动回填版本及来源；视觉确认须来自用户。分支按最终交付条件收尾，未验收任务保持开放。权限、记录边界与收尾细节见 [GIT_WORKFLOW](docs/GIT_WORKFLOW.md)。
