clear; clc;

%% 数据设定
t = (0 : 1e-6 : 3);                     % 仿真时间序列
freq = 170;                             % 频率
amp = 2.76;                             % 幅值
u_in = amp * sin(2 * pi * freq * t);    % 输入电压

%% 数据导入到模型
u_in_data = [t', u_in'];

%% 启动仿真
model_name = 'LAVM_torque';
% open_system(model_name);
sim(model_name);

%% 从模型导出数据
T_o = avg_T_o(end);