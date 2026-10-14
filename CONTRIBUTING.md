# 参与 Riverlight 开发

需求、任务、依赖和负责人在 GitHub Issues/Projects 管理。先读 [工作流程](docs/GIT_WORKFLOW.md) 与 [阶段计划](docs/DEVELOPMENT_PLAN.md)，按任务范围读相关系统规范。

1. 选择范围和验收明确的任务，核对已有认领与依赖。在 Issue 按工作流程填写“任务认领”评论，收到成功回执后开始。
2. 从最新 dev 创建任务分支，使用有效 Git 分支名，不强制前缀或固定命名格式；通过认领和 PR 明确所属 Issue，不能使用 main/dev/gh-pages。并行工作使用不同 checkout/worktree，保护已有改动。共享资源须先认领。
3. 及早创建目标为 dev 的 Draft PR，正文写 `关联 #编号`。任务分支可以保存未完成工作；只有审查和检查通过的改动才集成到 dev。
4. 本地运行 `npm test`、`npm run check:privacy`、`npm run build`。浏览器回归先安装官方测试浏览器 `npx playwright install chromium`，再运行 `npm run test:browser`；浏览器结果和截图由 CI 保存，不提交本地报告。
5. 准备交付时转为正式 PR，由指定审查者检查当前版本。合并前解决与最新 dev 的冲突并完成集成检查。产品验收通过后才关闭 Issue。
6. 最终交付及合并后检查通过后清理远端任务分支；本地核对未提交/未推送内容及其他 worktree，再安全删除。分批交付期间保留，main/dev/gh-pages 不清理；返工从最新 dev 创建同一 Issue 的新分支。

认领命令、共享账号的审查记录、验收和交接格式以 [GIT_WORKFLOW](docs/GIT_WORKFLOW.md) 为准。项目所有者分别维护仓库和 Project 的协作者权限。并行数量按团队实际协调，不设固定上限。
