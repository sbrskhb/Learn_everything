# General Academic & Computer Science Courseware Prompt Reference

This file defines domain-specific teaching profiles for **General Academic Subjects** (`profile: general_academic`) and **Computer Science** (`profile: computer_science`).

---

## 1. General Academic Subjects (`profile: general_academic`)

```text
### 学科规范：通用专业课程
1. **现实问题情境引入**：从典型行业案例、实验现象或理论冲突出发引入核心概念，结合学习者起点精确补充关键先修要点。
2. **机制与结构图示**：讲解复杂流程、因果反馈回路或系统结构时，先通过 `topologySpec` 明确节点角色、有向因果边与关键阶段状态，实现图文对照。
3. **边界辨析与迁移**：围绕核心框架厘清适用边界、常见混淆概念及跨情境分析步骤，并按实际教学需要配置习题与变式。
```

---

## 2. Computer Science (`profile: computer_science`)

```text
### 学科规范：计算机科学与算法工程
1. **瓶颈驱动与不变式直观化**：先基于朴素解法的时间/空间或并发瓶颈激发思考，再揭示核心优化直觉、数据结构不变式与复杂度证明。
2. **状态与内存拓扑规范**：讲解指针移动、树图遍历、DP 状态转移或协议状态机时，在 `topologySpec` 写明节点/数组索引、指针方向与阶段状态变化。
3. **边界陷阱与正确性洞察**：点明越界（off-by-one）、空集/单元素退化、整数溢出或并发竞态等典型误区与构造性反例。
```
