const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

// 教师登录
const teacherLogin = async (req, res) => {
    try {
        const { username, password, role } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: '用户名和密码不能为空'
            });
        }

        // 验证角色
        if (role && role !== 'teacher') {
            return res.status(403).json({
                success: false,
                message: '身份验证失败，请选择正确的身份'
            });
        }

        // 查询教师用户信息（使用统一users表）
        console.log('教师登录尝试:', { username, role });
        
        const queryStr = `
            SELECT 
                u.id as user_id,
                u.username,
                u.password,
                u.user_type,
                u.status,
                u.teacher_id,
                t.teacher_id as teacher_code,
                t.name,
                t.title,
                t.department,
                t.email,
                t.phone
            FROM users u
            LEFT JOIN teachers t ON u.teacher_id = t.id
            WHERE u.username = ? AND u.user_type = 'teacher' AND u.status = 'active'
        `;

        const users = await query(queryStr, [username]);
        console.log('教师查询结果:', users.length, users.length > 0 ? users[0] : 'No user found');

        if (users.length === 0) {
            console.log('教师用户不存在:', username);
            return res.status(401).json({
                success: false,
                message: '用户名或密码错误'
            });
        }

        const user = users[0];

        // 验证密码
        console.log('密码验证中...', { 输入密码: password, 存储密码: user.password.substring(0, 20) + '...' });
        const isValidPassword = await bcrypt.compare(password, user.password);
        console.log('密码验证结果:', isValidPassword);
        
        if (!isValidPassword) {
            console.log('密码验证失败');
            return res.status(401).json({
                success: false,
                message: '用户名或密码错误'
            });
        }

        // 更新最后登录时间
        await query(
            'UPDATE users SET updated_at = NOW() WHERE id = ?',
            [user.user_id]
        );

        // 生成JWT令牌
        console.log('生成JWT令牌中...');
        const token = jwt.sign(
            {
                userId: user.user_id,
                teacherId: user.teacher_id,
                username: user.username,
                role: 'teacher',
                userType: 'teacher'
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        console.log('JWT令牌生成成功');

        // 返回用户信息（不包含密码）
        const userInfo = {
            id: user.user_id,
            teacherId: user.teacher_id,
            username: user.username,
            name: user.name,
            title: user.title,
            department: user.department,
            email: user.email,
            phone: user.phone,
            role: 'teacher',
            userType: 'teacher'
        };

        console.log('教师登录成功，返回响应:', { success: true, userInfo });
        
        res.json({
            success: true,
            message: '登录成功',
            data: {
                token,
                user: userInfo
            }
        });

    } catch (error) {
        console.error('=== 教师登录错误 ===');
        console.error('错误信息:', error.message);
        console.error('错误堆栈:', error.stack);
        
        res.status(500).json({
            success: false,
            message: '服务器内部错误: ' + error.message
        });
    }
};

// 获取当前教师信息
const getCurrentTeacher = async (req, res) => {
    try {
        const teacherId = req.user.teacherId;

        const queryStr = `
            SELECT 
                u.id as user_id,
                u.username,
                'teacher' as role,
                t.id as teacher_id,
                t.name,
                t.title,
                t.department,
                t.email,
                t.phone,
                t.introduction
            FROM users u
            JOIN teachers t ON u.teacher_id = t.id
            WHERE t.id = ? AND u.user_type = 'teacher'
        `;

        const teachers = await query(queryStr, [teacherId]);

        if (teachers.length === 0) {
            return res.status(404).json({
                success: false,
                message: '教师信息不存在'
            });
        }

        res.json({
            success: true,
            data: teachers[0]
        });

    } catch (error) {
        console.error('获取教师信息错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 更新教师个人信息
const updateTeacherProfile = async (req, res) => {
    try {
        const teacherId = req.user.teacherId;
        const { name, title, department, email, phone, introduction } = req.body;

        const updateQuery = `
            UPDATE teachers 
            SET name = ?, title = ?, department = ?, email = ?, phone = ?, introduction = ?
            WHERE id = ?
        `;

        await query(updateQuery, [name, title, department, email, phone, introduction, teacherId]);

        res.json({
            success: true,
            message: '个人信息更新成功'
        });

    } catch (error) {
        console.error('更新教师信息错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 修改密码
const changePassword = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: '当前密码和新密码不能为空'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: '新密码长度不能少于6位'
            });
        }

        // 获取当前密码
        const users = await query(
            'SELECT password FROM users WHERE id = ? AND user_type = "teacher"',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: '用户不存在'
            });
        }

        // 验证当前密码
        const isValidPassword = await bcrypt.compare(currentPassword, users[0].password);
        if (!isValidPassword) {
            return res.status(400).json({
                success: false,
                message: '当前密码错误'
            });
        }

        // 加密新密码
        const hashedNewPassword = await bcrypt.hash(newPassword, 10);

        // 更新密码
        await query(
            'UPDATE users SET password = ? WHERE id = ?',
            [hashedNewPassword, userId]
        );

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

// 教师注册（使用统一users表）
const teacherRegister = async (req, res) => {
    try {
        const { teacher_id, username, password, real_name, email, phone, role } = req.body;

        // 验证角色
        if (role && role !== 'teacher') {
            return res.status(403).json({
                success: false,
                message: '身份验证失败，请选择正确的身份'
            });
        }

        // 验证必填字段
        if (!teacher_id || !username || !password || !real_name) {
            return res.status(400).json({
                success: false,
                message: '工号、用户名、密码和真实姓名不能为空'
            });
        }

        // 检查用户名是否已存在
        const existingUsers = await query(
            'SELECT id FROM users WHERE username = ?',
            [username]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: '用户名已存在'
            });
        }

        // 检查教师是否存在
        const teachers = await query(
            'SELECT id, name, email, phone FROM teachers WHERE teacher_id = ?',
            [teacher_id]
        );

        if (teachers.length === 0) {
            return res.status(404).json({
                success: false,
                message: '教师信息不存在，请联系管理员'
            });
        }

        const teacher = teachers[0];

        // 密码加密
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // 插入新教师用户到users表
        const result = await query(
            `INSERT INTO users (username, password, real_name, email, phone, user_type, teacher_id, status) 
             VALUES (?, ?, ?, ?, ?, 'teacher', ?, 'active')`,
            [username, hashedPassword, real_name, email || teacher.email, phone || teacher.phone, teacher.id]
        );

        res.status(201).json({
            success: true,
            message: '注册成功',
            data: {
                user_id: result.insertId
            }
        });

    } catch (error) {
        console.error('教师注册错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

module.exports = {
    teacherLogin,
    teacherRegister,
    getCurrentTeacher,
    updateTeacherProfile,
    changePassword
};
