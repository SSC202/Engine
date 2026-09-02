clear; clc;

%% 数据设定
model_name = 'LAVM_torque';

% 仿真时间序列设置，与 LAVM_torque_test.m 中 t = 0:1e-6:3 保持一致。
opt.t_end = 3;
opt.dt = 1e-6;

% 优化变量 x = [A1_idx, A3_idx, A5_idx, A7_idx, A9_idx, A11_idx, f]
% 6 个谐波幅值统一按 0.01 V 量化，实际幅值 = 索引 * opt.amp_step。
% 基波 A1 搜索范围为 0 - 5 V，其余谐波 A3/A5/A7/A9/A11 搜索范围为 -5 - 5 V。
% f 为基波频率，单位 Hz，搜索范围 180 - 280 Hz。
opt.amp_step = 0.01;
opt.harmonics = [1 3 5 7 9 11];
opt.avg_i_out_max = 0.44;
opt.u_half_min = 0;
opt.u_half_max = 3.7;

amp_idx_lb_fund = 0;
amp_idx_ub_fund = 5 / opt.amp_step;
amp_idx_lb_harm = -5 / opt.amp_step;
amp_idx_ub_harm = 5 / opt.amp_step;
lb = [amp_idx_lb_fund, amp_idx_lb_harm, amp_idx_lb_harm, amp_idx_lb_harm, amp_idx_lb_harm, amp_idx_lb_harm, 180];
ub = [amp_idx_ub_fund, amp_idx_ub_harm, amp_idx_ub_harm, amp_idx_ub_harm, amp_idx_ub_harm, amp_idx_ub_harm, 280];
x0 = [round(2.5 / opt.amp_step), 0, 0, 0, 0, 0, 250];

% 优化器参数。多变量搜索空间更大，因此保留较高的评价次数。
opt.max_function_evaluations = 300;
opt.use_integer_frequency = true;
opt.bad_objective = 1e9;
opt.use_fast_restart = true;

% 线性约束接口。非线性约束在 lavmTorqueObjConstr 中通过 Ineq 返回。
A = [];
b = [];
Aeq = [];
beq = [];

% 清空优化历史记录。
lavmOptHistory('reset');

%% 数据导入到模型前的准备
load_system(model_name);
original_stop_time = get_param(model_name, 'StopTime');
original_fast_restart = get_param(model_name, 'FastRestart');
cleanup_obj = onCleanup(@() lavmRestoreModel(model_name, original_stop_time, original_fast_restart));

set_param(model_name, 'StopTime', num2str(opt.t_end));
if opt.use_fast_restart
    set_param(model_name, 'FastRestart', 'on');
end

% surrogateopt 的目标函数同时返回目标值 Fval 和非线性约束 Ineq。
objconstr = @(x) lavmTorqueObjConstr(x, model_name, opt);

%% 启动优化
if exist('surrogateopt', 'file') == 2
    solver_name = 'surrogateopt';
    intcon = 1:6;
    if opt.use_integer_frequency
        intcon = 1:7;
    end

    options = optimoptions('surrogateopt', ...
        'Display', 'off', ...
        'MaxFunctionEvaluations', opt.max_function_evaluations, ...
        'InitialPoints', x0, ...
        'UseParallel', false);

    [x_best, fval_best, exitflag, output] = surrogateopt( ...
        objconstr, lb, ub, intcon, A, b, Aeq, beq, options);
else
    error('Global Optimization Toolbox is required for surrogateopt.');
end

%% 从模型导出数据并整理结果
x_best_raw = x_best(:).';
best_amplitudes = opt.amp_step * x_best_raw(1:6);
best_f = x_best_raw(7);
best_avg_T_o = -fval_best;
best_avg_i_out = NaN;
best_u_half_min = NaN;
best_u_half_max = NaN;
best_constraints = NaN(3, 1);

if isstruct(output) && isfield(output, 'ineq') && ~isempty(output.ineq)
    best_constraints = output.ineq(:);
    best_avg_i_out = best_constraints(1) + opt.avg_i_out_max;
    best_u_half_max = best_constraints(2) + opt.u_half_max;
    best_u_half_min = opt.u_half_min - best_constraints(3);
end

x_best = [best_amplitudes, best_f];
history = lavmOptHistory('get');

if isempty(history)
    history_table = table();
else
    history_table = struct2table(history);
end

LAVM_torque_opt_result = struct( ...
    'solver', solver_name, ...
    'harmonics', opt.harmonics, ...
    'best_amplitudes', best_amplitudes, ...
    'best_A1', best_amplitudes(1), ...
    'best_A3', best_amplitudes(2), ...
    'best_A5', best_amplitudes(3), ...
    'best_A7', best_amplitudes(4), ...
    'best_A9', best_amplitudes(5), ...
    'best_A11', best_amplitudes(6), ...
    'best_f', best_f, ...
    'best_avg_T_o', best_avg_T_o, ...
    'best_avg_i_out', best_avg_i_out, ...
    'best_u_half_min', best_u_half_min, ...
    'best_u_half_max', best_u_half_max, ...
    'best_constraints', best_constraints, ...
    'avg_i_out_max', opt.avg_i_out_max, ...
    'u_half_min', opt.u_half_min, ...
    'u_half_max', opt.u_half_max, ...
    'x_best', x_best, ...
    'x_best_raw', x_best_raw, ...
    'objective_best', fval_best, ...
    'exitflag', exitflag, ...
    'output', output, ...
    'history', history_table);

assignin('base', 'LAVM_torque_opt_result', LAVM_torque_opt_result);
assignin('base', 'LAVM_torque_opt_history', history_table);

fprintf('\n最优结果：A=[%.6g %.6g %.6g %.6g %.6g %.6g] V, f = %.6g Hz, avg_T_o = %.12g, avg_i_out = %.12g\n', ...
    best_amplitudes(1), best_amplitudes(2), best_amplitudes(3), best_amplitudes(4), best_amplitudes(5), best_amplitudes(6), ...
    best_f, best_avg_T_o, best_avg_i_out);

%% 本地函数
function objconstr = lavmTorqueObjConstr(x, model_name, opt)
    % 单次评价：生成 1/3/5/7/9/11 次谐波激励，读取 avg_T_o、avg_i_out，并检查半周期电压约束。
    x = x(:).';
    amplitudes = opt.amp_step * x(1:6);
    f = x(7);

    t = (0:opt.dt:opt.t_end).';
    u_in = zeros(size(t));
    for k = 1:numel(opt.harmonics)
        u_in = u_in + amplitudes(k) * sin(2 * pi * opt.harmonics(k) * f * t);
    end
    u_in_data = [t, u_in];

    assignin('base', 'u_in_data', u_in_data);

    try
        sim_out = sim(model_name, 'ReturnWorkspaceOutputs', 'on');
        raw_avg_T_o = lavmGetWorkspaceValue(sim_out, 'avg_T_o');
        raw_avg_i_out = lavmGetWorkspaceValue(sim_out, 'avg_i_out');

        if isempty(raw_avg_T_o) || isempty(raw_avg_i_out)
            error('LAVM:MissingObjective', 'avg_T_o or avg_i_out was not created by the simulation.');
        end

        avg_T_o_value = lavmFinalValue(raw_avg_T_o);
        avg_i_out_value = lavmFinalValue(raw_avg_i_out);

        half_period = 1 / (2 * f);
        t_half = (0:opt.dt:half_period).';
        if t_half(end) < half_period
            t_half(end + 1, 1) = half_period;
        end

        u_half = zeros(size(t_half));
        for k = 1:numel(opt.harmonics)
            u_half = u_half + amplitudes(k) * sin(2 * pi * opt.harmonics(k) * f * t_half);
        end
        u_half_min_value = min(u_half);
        u_half_max_value = max(u_half);

        if ~isfinite(avg_T_o_value) || ~isfinite(avg_i_out_value) || ~isfinite(u_half_min_value) || ~isfinite(u_half_max_value)
            error('LAVM:InvalidObjective', 'avg_T_o, avg_i_out or half-cycle voltage is not finite.');
        end

        objconstr.Fval = -avg_T_o_value;
        objconstr.Ineq = [
            avg_i_out_value - opt.avg_i_out_max;
            u_half_max_value - opt.u_half_max;
            opt.u_half_min - u_half_min_value
        ];
        is_ok = true;
        message = '';
    catch ME
        avg_T_o_value = NaN;
        avg_i_out_value = NaN;
        u_half_min_value = NaN;
        u_half_max_value = NaN;
        objconstr.Fval = opt.bad_objective;
        objconstr.Ineq = [1; 1; 1];
        is_ok = false;
        message = ME.message;
    end

    lavmOptHistory('append', struct( ...
        'harmonics', opt.harmonics, ...
        'amplitudes', amplitudes, ...
        'f', f, ...
        'avg_T_o', avg_T_o_value, ...
        'avg_i_out', avg_i_out_value, ...
        'u_half_min', u_half_min_value, ...
        'u_half_max', u_half_max_value, ...
        'constraints', objconstr.Ineq(:).', ...
        'objective', objconstr.Fval, ...
        'feasible', is_ok && all(isfinite(objconstr.Ineq)) && all(objconstr.Ineq <= 0), ...
        'ok', is_ok, ...
        'message', message));

    fprintf('A=[%.6g %.6g %.6g %.6g %.6g %.6g] V, f = %.6g Hz, avg_T_o = %.12g, avg_i_out = %.12g\n', ...
        amplitudes(1), amplitudes(2), amplitudes(3), amplitudes(4), amplitudes(5), amplitudes(6), ...
        f, avg_T_o_value, avg_i_out_value);
end

function raw_value = lavmGetWorkspaceValue(sim_out, var_name)
    raw_value = [];
    if isa(sim_out, 'Simulink.SimulationOutput')
        try
            raw_value = sim_out.get(var_name);
        catch
            raw_value = [];
        end
    end
end

function value = lavmFinalValue(raw_value)
    if isa(raw_value, 'timeseries')
        data = raw_value.Data;
    elseif isstruct(raw_value) && isfield(raw_value, 'signals')
        data = raw_value.signals.values;
    elseif istimetable(raw_value)
        data = raw_value{:, end};
    else
        data = raw_value;
    end

    data = squeeze(data);
    if isempty(data)
        error('LAVM:EmptyObjective', 'workspace value is empty.');
    end

    value = double(data(end));
end

function history = lavmOptHistory(action, record)
    persistent records
    switch action
        case 'reset'
            records = struct('harmonics', {}, 'amplitudes', {}, 'f', {}, 'avg_T_o', {}, 'avg_i_out', {}, 'u_half_min', {}, 'u_half_max', {}, 'constraints', {}, 'objective', {}, 'feasible', {}, 'ok', {}, 'message', {});
            history = records;
        case 'append'
            if nargin < 2
                error('LAVM:MissingHistoryRecord', 'A history record is required for append.');
            end
            records(end + 1) = record;
            history = records;
        case 'get'
            if isempty(records)
                records = struct('harmonics', {}, 'amplitudes', {}, 'f', {}, 'avg_T_o', {}, 'avg_i_out', {}, 'u_half_min', {}, 'u_half_max', {}, 'constraints', {}, 'objective', {}, 'feasible', {}, 'ok', {}, 'message', {});
            end
            history = records;
        otherwise
            error('LAVM:BadHistoryAction', 'Unknown history action: %s', action);
    end
end

function lavmRestoreModel(model_name, stop_time, fast_restart)
    if ~bdIsLoaded(model_name)
        return;
    end

    try
        set_param(model_name, 'FastRestart', fast_restart);
    catch
    end

    try
        set_param(model_name, 'StopTime', stop_time);
    catch
    end
end
