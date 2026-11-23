# 操作互斥（#55）

`operation-policy.js` 的 `operationCapabilities(state, continuing)` 是纯派生函数，主进程与侧栏复用。状态仍由 job controller、各操作 controller 和 runtime store 持有，没有新增锁。

生成（含终态后的 helper 退出和取消文件清理）、字幕加载、校对、删除、关联、导入会阻止新的互斥操作。`continuing` 仅让指定操作继续自身的保存/确认，不能放行其他入口；重复启动、会话身份与媒体/路径校验继续由原 controller 执行。取消仍可执行。

语义收紧：字幕加载期间拒绝生成、重复加载、显示切换和重试；导出消息在冲突期间也拒绝。此前部分主进程入口允许这些操作，和侧栏禁用状态不一致。字幕库列表读取只影响界面准备状态与候选校验，不作为独立操作锁。

矩阵测试覆盖所有 owner、running/canceling/loading、终态仍持有 owner、自身继续及其他入口拒绝；主进程测试覆盖异步加载期间的重复消息。已有 controller/main tests 覆盖保存、确认、导入取消、媒体切换与异常释放。

回退本 PR 即可恢复分散守卫；不改变协议、偏好或文件格式。新策略脚本已列入页面加载和打包清单。
