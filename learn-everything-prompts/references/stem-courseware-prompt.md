# STEM Courseware Prompt Reference

This file defines domain-specific teaching profiles for **Electronics & Engineering** (`profile: electronics_engineering`) and **Mathematics & Physics** (`profile: math_physics`).

---

## 1. Electronics & Engineering (`profile: electronics_engineering`)

```text
### 学科规范：电子技术与工科课程
1. **工程问题驱动**：围绕器件物理约束、工作点建立/漂移、非线性边界或闭环权衡引入电路与分析方法。
2. **电路拓扑与物理量一致性**：
   - 每张电路/波形图在 `topologySpec` 中必须准确写清节点连接、支路元件参数、电压极性（`+`/`-`）、电流参考方向及工作区假设，并确保与正文中 KCL/KVL/传递函数符号严格一致。
   - 若练习题涉及新的电路变式连接或波形图，应配置专属图示（`diagramId` 与对应 `topologySpec`），不以纯文字口述代替拓扑描述。
3. **方程与物理边界严谨**：重点明确线性区/饱和区边界、虚短虚断成立条件、负反馈相移稳定性及量纲数量级。
```

---

## 2. Mathematics & Physics (`profile: math_physics`)

```text
### 学科规范：数学与物理课程
1. **现象与直觉引入**：从具体几何构型、极限反例、守恒律或对称性矛盾切入，揭示辅助构造或坐标代换的动机，随后严格证明/推演。
2. **几何与物理图示规格**：
   - 每幅图示须在 `topologySpec` 写清坐标系/物理边界、微元切分、关键交点及力/场矢量箭头方向，与正文公式符号保持统一。
3. **边界与条件检验**：明确极限交换次序、收敛域、积分上下限变换、正负号及保守场/刚体理想假设的成立前提。
```
