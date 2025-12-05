const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

// 管理员登录
exports.login = async (req, res) => {
    try {
        const { username, password, role } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: '用户名和密码不能为空'
            });
        }

        // 验证角色
        if (role && role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: '身份验证失败，请选择正确的身份'
            });
        }

        // 查询管理员用户
        console.log('管理员登录尝试:', { username, role });
        
        const users = await query(
            'SELECT * FROM admin_users WHERE username = ? AND status = "active"',
            [username]
        );
        
        console.log('管理员查询结果:', users.length, users.length > 0 ? users[0] : 'No user found');

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: '用户名或密码错误'
            });
        }

        const user = users[0];

        // 验证密码
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: '用户名或密码错误'
            });
        }

        // 更新最后登录时间和IP
        const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
        await query(
            'UPDATE admin_users SET last_login = NOW(), login_ip = ? WHERE id = ?',
            [clientIP, user.id]
        );

        // 生成JWT令牌
        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                role: user.role,
                userType: 'admin'
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // 记录登录日志
        try {
            await query(
                `INSERT INTO admin_operation_logs 
                 (admin_id, operation_type, operation_module, operation_description, ip_address, user_agent, result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [user.id, 'LOGIN', 'AUTH', '管理员登录', clientIP, req.get('User-Agent') || '', 'SUCCESS']
            );
        } catch (logError) {
            console.log('记录登录日志失败，可能是表不存在:', logError.message);
        }

        // 返回用户信息（不包含密码）
        const userInfo = {
            id: user.id,
            username: user.username,
            real_name: user.real_name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            permissions: user.permissions ? (typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions) : [],
            userType: 'admin'
        };

        console.log('管理员登录成功:', userInfo);

        res.json({
            success: true,
            message: '登录成功',
            data: {
                token,
                user: userInfo
            }
        });

    } catch (error) {
        console.error('管理员登录错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误: ' + error.message
        });
    }
};

// 获取当前管理员信息
exports.getCurrentAdmin = async (req, res) => {
    try {
        const adminId = req.user.id;

        const users = await query(
            `SELECT id, username, real_name, email, phone, role, permissions, status, last_login, login_ip
             FROM admin_users WHERE id = ?`,
            [adminId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: '管理员不存在'
            });
        }

        const user = users[0];
        user.permissions = user.permissions ? (typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions) : [];
        user.userType = 'admin'; // 添加userType标识

        res.json({
            success: true,
            data: user
        });

    } catch (error) {
        console.error('获取管理员信息错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 修改密码
exports.changePassword = async (req, res) => {
    try {
        const adminId = req.user.id;
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: '旧密码和新密码不能为空'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: '新密码长度不能少于6位'
            });
        }

        // 获取当前用户信息
        const users = await query(
            'SELECT password FROM admin_users WHERE id = ?',
            [adminId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: '管理员不存在'
            });
        }

        // 验证旧密码
        const isValidPassword = await bcrypt.compare(oldPassword, users[0].password);
        if (!isValidPassword) {
            return res.status(400).json({
                success: false,
                message: '旧密码错误'
            });
        }

        // 加密新密码
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // 更新密码
        await query(
            'UPDATE admin_users SET password = ?, updated_at = NOW() WHERE id = ?',
            [hashedPassword, adminId]
        );

        // 记录操作日志
        try {
            await query(
                `INSERT INTO admin_operation_logs 
                 (admin_id, operation_type, operation_module, operation_description, ip_address, user_agent, result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [adminId, 'UPDATE', 'AUTH', '修改密码', req.ip, req.get('User-Agent') || '', 'SUCCESS']
            );
        } catch (logError) {
            console.log('记录操作日志失败:', logError.message);
        }

        res.json({
            success: true,
            message: '密码修改成功'
        });

    } catch (error) {
        console.error('修改密码错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 退出登录
exports.logout = async (req, res) => {
    try {
        const adminId = req.user.id;

        // 记录登出日志
        try {
            await query(
                `INSERT INTO admin_operation_logs 
                 (admin_id, operation_type, operation_module, operation_description, ip_address, user_agent, result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [adminId, 'LOGOUT', 'AUTH', '管理员登出', req.ip, req.get('User-Agent') || '', 'SUCCESS']
            );
        } catch (logError) {
            console.log('记录登出日志失败:', logError.message);
        }

        res.json({
            success: true,
            message: '退出登录成功'
        });

    } catch (error) {
        console.error('退出登录错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取管理员列表
exports.getAdminList = async (req, res) => {
    try {
        const { page = 1, limit = 10, username, role, status } = req.query;
        const offset = (page - 1) * limit;

        let whereConditions = [];
        let params = [];

        if (username) {
            whereConditions.push('username LIKE ?');
            params.push(`%${username}%`);
        }

        if (role) {
            whereConditions.push('role = ?');
            params.push(role);
        }

        if (status) {
            whereConditions.push('status = ?');
            params.push(status);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // 获取总数
        const countResult = await query(
            `SELECT COUNT(*) as total FROM admin_users ${whereClause}`,
            params
        );

        // 获取管理员列表
        const admins = await query(
            `SELECT id, username, real_name, email, phone, role, status, last_login, login_ip, created_at
             FROM admin_users ${whereClause}
             ORDER BY created_at DESC
             LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`,
            params
        );

        res.json({
            success: true,
            data: {
                admins,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult[0].total,
                    pages: Math.ceil(countResult[0].total / limit)
                }
            }
        });

    } catch (error) {
        console.error('获取管理员列表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 创建管理员
exports.createAdmin = async (req, res) => {
    try {
        const { username, password, real_name, email, phone, role, permissions } = req.body;

        if (!username || !password || !real_name || !role) {
            return res.status(400).json({
                success: false,
                message: '用户名、密码、真实姓名和角色不能为空'
            });
        }

        // 检查用户名是否已存在
        const existingUsers = await query(
            'SELECT id FROM admin_users WHERE username = ?',
            [username]
        );

        if (existingUsers.length > 0) {
            return res.status(400).json({
                success: false,
                message: '用户名已存在'
            });
        }

        // 加密密码
        const hashedPassword = await bcrypt.hash(password, 10);

        // 创建管理员
        const result = await query(
            `INSERT INTO admin_users (username, password, real_name, email, phone, role, permissions)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [username, hashedPassword, real_name, email, phone, role, permissions ? (typeof permissions === 'string' ? permissions : JSON.stringify(permissions)) : null]
        );

        // 记录操作日志
        try {
            await query(
                `INSERT INTO admin_operation_logs 
                 (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.user.id, 'CREATE', 'ADMIN', `创建管理员: ${username}`, 'admin_user', result.insertId, req.ip, req.get('User-Agent') || '', 'SUCCESS']
            );
        } catch (logError) {
            console.log('记录操作日志失败:', logError.message);
        }

        res.json({
            success: true,
            message: '管理员创建成功',
            data: { adminId: result.insertId }
        });

    } catch (error) {
        console.error('创建管理员错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 更新管理员信息
exports.updateAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { real_name, email, phone, role, permissions, status } = req.body;
        const currentAdminId = req.user.id;

        // 检查管理员是否存在
        const existingUsers = await query(
            'SELECT * FROM admin_users WHERE id = ?',
            [id]
        );

        if (existingUsers.length === 0) {
            return res.status(404).json({
                success: false,
                message: '管理员不存在'
            });
        }

        const oldData = existingUsers[0];

        // 更新管理员信息
        await query(
            `UPDATE admin_users 
             SET real_name = ?, email = ?, phone = ?, role = ?, permissions = ?, status = ?, updated_at = NOW()
             WHERE id = ?`,
            [real_name, email, phone, role, JSON.stringify(permissions || []), status, id]
        );

        // 记录操作日志
        try {
            await query(
                `INSERT INTO admin_operation_logs 
                 (admin_id, operation_type, operation_module, operation_description, target_type, target_id, old_data, new_data, ip_address, user_agent, result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [currentAdminId, 'UPDATE', 'ADMIN', `更新管理员信息: ${oldData.username}`, 'admin_user', id, JSON.stringify(oldData), JSON.stringify(req.body), req.ip, req.get('User-Agent') || '', 'SUCCESS']
            );
        } catch (logError) {
            console.log('记录操作日志失败:', logError.message);
        }

        res.json({
            success: true,
            message: '管理员信息更新成功'
        });

    } catch (error) {
        console.error('更新管理员信息错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 重置管理员密码
exports.resetAdminPassword = async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: '新密码不能为空且长度不能少于6位'
            });
        }

        // 检查管理员是否存在
        const existingUsers = await query(
            'SELECT username FROM admin_users WHERE id = ?',
            [id]
        );

        if (existingUsers.length === 0) {
            return res.status(404).json({
                success: false,
                message: '管理员不存在'
            });
        }

        // 加密新密码
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // 更新密码
        await query(
            'UPDATE admin_users SET password = ?, updated_at = NOW() WHERE id = ?',
            [hashedPassword, id]
        );

        // 记录操作日志
        try {
            await query(
                `INSERT INTO admin_operation_logs 
                 (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.user.id, 'UPDATE', 'ADMIN', `重置管理员密码: ${existingUsers[0].username}`, 'admin_user', id, req.ip, req.get('User-Agent') || '', 'SUCCESS']
            );
        } catch (logError) {
            console.log('记录操作日志失败:', logError.message);
        }

        res.json({
            success: true,
            message: '密码重置成功'
        });

    } catch (error) {
        console.error('重置密码错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};
