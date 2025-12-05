const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { generateToken } = require('../middleware/auth');

// 用户登录
const login = async (req, res) => {
    try {
        const { username, password, role } = req.body;

        // 验证输入
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: '用户名和密码不能为空'
            });
        }

        // 验证角色
        if (role && role !== 'student') {
            return res.status(403).json({
                success: false,
                message: '身份验证失败，请选择正确的身份'
            });
        }

        // 查找学生用户（添加user_type检查）
        const users = await query(
            `SELECT id, student_id, username, password, real_name, status, user_type 
             FROM users 
             WHERE (username = ? OR student_id = ?) AND (user_type = 'student' OR user_type IS NULL)`,
            [username, username]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: '用户名或密码错误'
            });
        }

        const user = users[0];

        // 检查用户状态
        if (user.status !== 'active') {
            return res.status(401).json({
                success: false,
                message: '账户已被禁用，请联系管理员'
            });
        }

        // 验证密码
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            console.log('密码验证失败:', {
                username: user.username,
                inputPassword: password,
                storedHash: user.password
            });
            return res.status(401).json({
                success: false,
                message: '用户名或密码错误'
            });
        }

        // 生成JWT令牌
        const token = generateToken(user.id, user.student_id, 'student');

        // 返回登录成功信息（不包含密码）
        res.json({
            success: true,
            message: '登录成功',
            data: {
                token,
                user: {
                    id: user.id,
                    student_id: user.student_id,
                    username: user.username,
                    real_name: user.real_name,
                    role: 'student'
                }
            }
        });

    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 用户注册（可选功能，根据需求决定是否开放）
const register = async (req, res) => {
    try {
        const { student_id, username, password, real_name, email, phone, grade, major, class_name, role } = req.body;

        // 验证角色
        if (role && role !== 'student') {
            return res.status(403).json({
                success: false,
                message: '身份验证失败，请选择正确的身份'
            });
        }

        // 验证必填字段
        if (!student_id || !username || !password || !real_name) {
            return res.status(400).json({
                success: false,
                message: '学号、用户名、密码和真实姓名不能为空'
            });
        }

        // 检查学号和用户名是否已存在
        const existingUsers = await query(
            'SELECT id FROM users WHERE student_id = ? OR username = ?',
            [student_id, username]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: '学号或用户名已存在'
            });
        }

        // 密码加密
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // 插入新用户（设置user_type为student）
        const result = await query(
            `INSERT INTO users (student_id, username, password, real_name, email, phone, grade, major, class_name, user_type) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'student')`,
            [student_id, username, hashedPassword, real_name, email, phone, grade, major, class_name]
        );

        res.status(201).json({
            success: true,
            message: '注册成功',
            data: {
                user_id: result.insertId
            }
        });

    } catch (error) {
        console.error('注册错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取当前用户信息
const getCurrentUser = async (req, res) => {
    try {
        const userId = req.user.id;

        const users = await query(
            `SELECT u.id, u.student_id, u.username, u.real_name, u.gender, u.email, u.phone, 
                    u.grade, u.major, u.class_name, u.credit_limit, u.status,
                    COUNT(cs.id) as selected_courses_count,
                    COALESCE(SUM(c.credits), 0) as total_credits
             FROM users u
             LEFT JOIN course_selections cs ON u.id = cs.user_id AND cs.status = 'selected'
             LEFT JOIN courses c ON cs.course_id = c.id
             WHERE u.id = ?
             GROUP BY u.id`,
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: '用户不存在'
            });
        }

        res.json({
            success: true,
            data: {
                ...users[0],
                role: 'student'
            }
        });

    } catch (error) {
        console.error('获取用户信息错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 更新用户信息
const updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { real_name, gender, email, phone } = req.body;

        // 验证性别值
        if (gender && !['male', 'female'].includes(gender)) {
            return res.status(400).json({
                success: false,
                message: '性别参数不正确'
            });
        }

        // 更新用户信息（只允许更新部分字段）
        await query(
            'UPDATE users SET real_name = ?, gender = ?, email = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [real_name, gender, email, phone, userId]
        );

        res.json({
            success: true,
            message: '个人信息更新成功'
        });

    } catch (error) {
        console.error('更新用户信息错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 修改密码
const changePassword = async (req, res) => {
    try {
        const userId = req.user.id;
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: '旧密码和新密码不能为空'
            });
        }

        // 获取当前密码
        const users = await query('SELECT password FROM users WHERE id = ?', [userId]);
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: '用户不存在'
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
        const saltRounds = 10;
        const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

        // 更新密码
        await query(
            'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
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

module.exports = {
    login,
    register,
    getCurrentUser,
    updateProfile,
    changePassword
};
