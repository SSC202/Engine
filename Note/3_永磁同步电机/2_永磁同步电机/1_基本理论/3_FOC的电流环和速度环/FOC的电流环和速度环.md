# Engine FOC的电流环和速度环参数整定

## 1. 电流环

dq 坐标系下的电压方程可以表示为：
$$
\begin{cases}
\frac{d}{dt}i_d = -\frac{R_s}{L_d}i_d+\frac{L_q}{L_d}\omega_ei_q+\frac{1}{L_d}u_d \\
\frac{d}{dt}i_q = -\frac{R_s}{L_d}i_d+\frac{1}{L_q}\omega_e(L_di_d+\psi_f)+\frac{1}{L_q}u_q
\end{cases}
$$
定子电流分别在q轴和d轴产生耦合电动势，对上述方程进行解耦得到变换后的电压 $u_{d0}$ 和 $u_{q0}$ ：
$$
\begin{cases}
u_{d0} = u_d + \omega_eL_qi_q = Ri_d+L_d\frac{d}{dt}i_d \\
u_{q0} = u_q - \omega_e(L_di_d+\psi_f)=Ri_q+L_q\frac{d}{dt}i_q
\end{cases}
$$
 拉氏变换得到：
$$
\begin{bmatrix}
u_{d0} \\
u_{q0}
\end{bmatrix} 
=
\begin{bmatrix}
R_s+sL_d & 0 \\
0 & R_s+sL_q
\end{bmatrix} 
\begin{bmatrix}
i_d \\
i_q
\end{bmatrix}
$$
![NULL](./assets/picture_21.jpg)

采用 PI 控制器后可以得到输出方程为：
$$
\begin{cases}
u_d^* = (K_{pd}+\frac{K_{id}}{s})(i_d^*-i_d)-\omega_eL_qi_q \\
u_q^* = (K_{pq}+\frac{K_{iq}}{s})(i_q^*-i_q)+\omega_e(L_di_d+\psi_f)
\end{cases}
$$
如果使用前馈解耦（考虑反电动势时），虽然 PI 控制器的参数可以按照典型Ⅰ型系统进行设计，但该方法却仅当电机的实际参数与模型参数匹配时，交叉耦合电动势才能得到完全解耦。再考虑到模型误差，应当采用采用模型精度要求低且对参数变化不灵敏的控制方式。

- 内模控制进行PI参数整定

  [参考资料1](https://www.bilibili.com/read/cv24581856/)

  ![NULL](./assets/picture_22.jpg)

  $\hat{G(s)}$ 为过程模型， $G(s)$ 为被控过程， $C(s)$ 为内模控制器。

  对上述系统进行相加点交换，得到等效控制器：
  $$
  C^*(s) = \frac{C(s)}{1-C(s)\hat{G(s)}}
  $$
  系统闭环响应为：
  $$
  Y(s) = \frac{C(s)G(s)}{1+C(s)(G(s)-\hat{G(s)})}X(s)
  $$
  反馈信号为：
  $$
  F(s) = (G(s)-\hat G(s))U(s)
  $$
  模型精确时， $G(s) = \hat{G(s)}$ ，反馈信号为0，则在模型精确和无外界扰动输入的条件下，内模控制具有开环结构，且稳定性取决于控制器和被控过程。对开环稳定的过程而言，反馈的目的是克服过程的不确定性。也就是说，如果过程和过程输入都完全清楚，只需要前馈（开环）控制，而不需要反馈（闭环）控制。事实上，在工业过程控制中，克服扰动是控制系统的主要任务，而模型不确定性也是难免的。此时，反馈信号就反映了过程模型的不确定性和扰动的影响，从而构成了闭环控制结构。

  当被控过程稳定且模型精确 $G(s) = \hat{G(s)}$ 时，设计控制器使得 $ C(s) = \hat{G(s)}^{-1}$ 可以使得系统输出值都等于系统输入设定值。

  设计控制器时，通常需要加上滤波器从而保证系统的稳定性和鲁棒性。 使得：
  $$
  C(s) = \hat{G(s)}^{-1} \frac{1}{(Ts+1)^\gamma}
  $$

  因此，整定过程如下：

  [参考资料2](https://www.bilibili.com/read/cv25000595/)

  <font color=LightGreen>1. 求得内模控制器</font>
  $$
  C(s) = \hat{G(s)}^{-1} \frac{1}{(Ts+1)^\gamma}
  $$
  基于内模控制的PID控制器设计中可以允许 $C(s)$ 的分子阶数大于分母的阶数。 由于电机的电磁时间常数比机械时间常数小很多，控制系统的电流环可近似视为一阶系统，取滤波器参数为1。
  $$
  G(s) = \hat{G(s)} = \begin{bmatrix}
  R_s+sL_d & 0 \\
  0 & R_s+sL_q
  \end{bmatrix}
  $$
  <font color=LightGreen>2. 求得内模控制的等效反馈控制器</font>
  $$
  C^*(s) = \frac{C(s)}{1-C(s)\hat{G(s)}}
  $$
  求得：
  $$
  C^*(s) = \alpha 
  \begin{bmatrix}
  L_d+\frac{R}{s} & 0 \\
  0 & L_q+\frac{R}{s}
  \end{bmatrix}
  $$
  <font color=LightGreen>3. 通过比较内模控制的等效反馈控制器与PID控制器的标准形式，则可求得PID的控制参数。对于一阶系统，采用PI控制形式就可，对于二阶系统，采用PID控制形式即可。</font>
  $$
  \begin{cases}
  K_{pd} = \alpha L_d \\
  K_{id} = \alpha R_s \\
  K_{pq} = \alpha L_q \\
  K_{iq} = \alpha R_s
  \end{cases}
  $$
  <font color=LightGreen>4. 通过调节滤波器参数去平衡PID控制的动态性能和稳态误差。</font>
  
  > **从零极点配置方面看参数设计：**
  >
  > 系统的传递函数可以表示为：
  > $$
  > G(s)=\frac{1}{sL+R}
  > $$
  > 为一阶系统，存在一个极点 $p = -\frac{R}{L}$。
  >
  > 使用 PI 控制器后的开环传递函数：
  > $$
  > G(s)G_{PI}(s)=\frac{K_ps+K_i}{s}\frac{1}{sL+R}
  > $$
  > PI 控制器存在一个开环零点 $s = -\frac{K_i}{K_p}$ 和一个开环极点 $p=0$；原点处的开环极点可以增加系统型别，使得闭环系统可以实现阶跃无静差跟踪，但是降低了系统稳定性；但是 PI 控制器的开环零点可以对稳定性进行补偿。设计时需要使得开环零点 $s = -\frac{K_i}{K_p}$ 和开环极点 $p = -\frac{R}{L}$ 对消，使得开环系统为纯积分系统。
  >
  > 此时的闭环系统为：
  > $$
  > G(s) = \frac{\alpha}{s+\alpha}
  > $$
  > 系统的时间常数 $\tau = \frac{1}{\alpha}$，因此 $\alpha$ 越大，系统相应越快。
  >
  > 零极点对消的意义是消除系统的固有极点，使得系统设计变成参数化设计。

## 2. 速度环

设计目标与电流环一致，需要让速度环近似为一个一阶系统，设计时，电流环带宽需要是速度环带宽的 5-10 倍，因此可以忽略整定后的电流环传递函数。

机械方程为：
$$
J\frac{d\omega}{dt} = T_e - T_L -B\omega
$$
$T_L$ 视为扰动，假设 $i_d = 0$，则速度到电流的传递函数为：
$$
G(s) = \frac{1.5p\psi_f}{Js+B}
$$
速度环 PI 控制器：
$$
G_c(s) = K_{p\omega}+\frac{K_{i\omega}}{s}
$$
消除机械极点对系统动态的影响，令：
$$
\frac{K_{i\omega}}{K_{p\omega}}=\frac{B}{J}
$$
此时零极点对消，开环传递函数变为纯积分环节，闭环传递函数按照以下方式设计， $\beta$ 为带宽：
$$
G(s) = \frac{\beta}{s+\beta}
$$
其中 $\beta = \frac{1.5K_{p\omega}p\psi_f}{J}$，由此可得：
$$
\begin{cases}
K_{p\omega} = \frac{\beta J}{1.5p\psi_f} \\
K_{i\omega} = \frac{\beta B}{1.5p\psi_f}
\end{cases}
$$
电机的转动惯量都很难得到一个较准确的值，一些电机出厂铭牌中也少有提到，根据经验值可以自己判断（即使用手动调参法）。