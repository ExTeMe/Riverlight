---
title: Riverlight 项目管理工作流规范
version: 1.0
date_created: 2026-10-13
last_updated: 2026-10-13
owner: Riverlight maintainers
tags: [process, github-actions, project-management]
---

## 目标与范围

在 GitHub 管理任务、阶段与验收，维护仓库里程碑、任务关系和个人 Project。任务数据来自 Issues，不维护本地状态镜像，不依赖 GitHub CLI。

## 事件与结果

| 输入 | 预期结果 |
| --- | --- |
| dev 中管理工作流或脚本变更 | 初始化标签、阶段里程碑、任务关系与 Project |
| Issue 新建、编辑、状态标签变更、关闭或重开 | 读取最新 Issue，补齐当前任务元数据并同步 Project |
| 手动初始化 | 幂等核对所有现有任务，补齐阶段与关系；不重复建任务 |
| 普通手动运行 | 按 GitHub 当前数据修复 Project 状态 |

## 契约与权限

| 项目 | 约束 |
| --- | --- |
| 仓库访问 | 仓库令牌仅需源码读取、Issues 写入 |
| Project 访问 | 独立 Secret `PROJECT_TOKEN`；个人 Projects 与私有仓库所需授权由所有者设置；令牌不进入源码、输出或任务正文 |
| 项目标识 | 可选变量 `PROJECT_NUMBER` 指向现有项目；未设置时精确匹配 `Riverlight 开发`，初始化才能创建 |
| 阶段与关系 | 阶段和任务 ID 在 Issue 中保留；阶段规格来自 DEVELOPMENT_PLAN，关联关系使用原生子任务与阻塞关系。变更阶段同步里程碑和父任务；明确修改前置字段时移除本项目中失效的任务依赖，保留其他引用 |
| 状态入口 | Issue 的状态与互斥标签 `status:in-progress`、`status:review`、`status:blocked`；Project 为自动生成的视图，不同时手工维护两套状态 |
| 视觉验收 | 需用户确认的任务，只有收到当前版本确认后才添加 `visual-approved`；提前关闭但缺确认时仍显示待验收 |

## 执行与失败边界

- 每个仓库串行运行，最多 20 分钟；API 分页读取，避免只处理首页任务。
- 事件中旧的正文或状态不作为依据，执行时重新读取任务。
- Issue 正文仅作为数据解析，不执行其中的命令；Issue 事件使用默认分支的可信脚本。
- 已有 Project 的选项或访问关系不符合预期时明确失败；不清空项目，不覆盖有内容的状态字段。
- 多个同名项目要求指定项目编号；重复任务编号和互相冲突的状态标签要求分诊修复。
- 授权缺失/API 失败时报告失败，不能写成已同步；凭据及未过滤的 API 响应不打印。

## 验收

- 核验阶段任务、子任务、依赖及仓库 Project 关联；重复初始化不重复创建关系。
- 验证开始、待验收、阻塞、关闭和重开；视觉确认门槛不被提交或合并绕过。
- 新任务修改范围或依赖后可同步，任务数据只在 GitHub 更新。
- 本地测试验证转换、分页、凭据保护和模拟 API 联调；真实 GitHub 首次运行另行核验权限与响应。

实现入口：`.github/workflows/project-management.yml` 与 `scripts/github-management.mjs`。版本 1.0：初始契约；后续先更新行为契约，再修改和验证工作流。
