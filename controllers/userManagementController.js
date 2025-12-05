const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('../config/database');
const { logAdminOperation } = require('./adminAuthController');

// 获取学生列表
async function getStudents(req, res) {
    try {
        const { 
            page = 1, 
            limit = 20, 
            keyword = '', 
            grade = '', 
            major = '',
            status = '' 
        } = req.query;

        const connection = await mysql.createConnection(config);
        
        // 构建查询条件
        let whereClause = '1=1';
        const queryParams = [];
        
        if (keyword) {
            whereClause += ' AND (real_name LIKE ? OR student_id LIKE ? OR email LIKE ?)';
            queryParams.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
        }
        
        if (grade) {
            whereClause += ' AND grade = ?';
            queryParams.push(grade);
        }
        
        if (major) {
            whereClause += ' AND major LIKE ?';
            queryParams.push(`%${major}%`);
        }
        
        if (status) {
            whereClause += ' AND status = ?';
            queryParams.push(status);
        }

        // 添加用户类型条件
        whereClause += ' AND user_type = ?';
        queryParams.push('student');

        // 获取总数
        const countQuery = `SELECT COUNT(*) as total FROM users WHERE ${whereClause}`;
        const [countResult] = await connection.execute(countQuery, queryParams);
        const total = countResult[0].total;

        // 获取分页数据
        const offset = (page - 1) * limit;
        const dataQuery = `
            SELECT id, student_id, username, real_name, grade, major, class_name, 
                   email, phone, credit_limit, status, created_at
            FROM users 
            WHERE ${whereClause}
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `;
        const [rows] = await connection.execute(dataQuery, [...queryParams, parseInt(limit), parseInt(offset)]);

        await connection.end();

        // 记录操作日志
        await logAdminOperation(
            req.user.id,
            'read',
            'user_management',
            '获取学生列表',
            { filters: req.query },
            'success',
            req
        );

        res.json({
            success: true,
            data: rows,
            total,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error('获取学生列表失败:', error);
        res.status(500).json({
            success: false,
            message: '获取学生列表失败'
        });
    }
}

// 创建学生
async function createStudent(req, res) {
    try {
        const { 
            student_id, 
            username, 
            real_name, 
            grade, 
            major, 
            class_name, 
            email, 
            phone, 
            credit_limit, 
            password 
        } = req.body;

        // 验证必填字段
        if (!student_id || !username || !real_name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: '请填写必填字段'
            });
        }

        const connection = await mysql.createConnection(config);

        // 检查学号和用户名是否已存在
        const checkQuery = 'SELECT id FROM users WHERE student_id = ? OR username = ?';
        const [existing] = await connection.execute(checkQuery, [student_id, username]);
        
        if (existing.length > 0) {
            await connection.end();
            return res.status(400).json({
                success: false,
                message: '学号或用户名已存在'
            });
        }

        // 加密密码
        const hashedPassword = await bcrypt.hash(password, 10);

        // 创建学生
        const insertQuery = `
            INSERT INTO users (
                student_id, username, password, real_name, grade, major, 
                class_name, email, phone, credit_limit, status, user_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'student')
        `;
        
        const [result] = await connection.execute(insertQuery, [
            student_id, username, hashedPassword, real_name, grade, major,
            class_name, email, phone, credit_limit || 2
        ]);

        await connection.end();

        // 记录操作日志
        await logAdminOperation(
            req.user.id,
            'create',
            'user_management',
            `创建学生: ${real_name} (${student_id})`,
            { student_id, username, real_name, email },
            'success',
            req
        );

        res.json({
            success: true,
            message: '学生创建成功',
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('创建学生失败:', error);
        
        await logAdminOperation(
            req.user.id,
            'create',
            'user_management',
            `创建学生失败: ${req.body.real_name}`,
            req.body,
            'failed',
            req,
            error.message
        );
        
        res.status(500).json({
            success: false,
            message: '创建学生失败'
        });
    }
}

// 更新学生
async function updateStudent(req, res) {
    try {
        const studentId = req.params.id;
        const { 
            student_id, 
            username, 
            real_name, 
            grade, 
            major, 
            class_name, 
            email, 
            phone, 
            credit_limit,
            status 
        } = req.body;

        const connection = await mysql.createConnection(config);

        // 获取原始数据
        const [originalData] = await connection.execute(
            'SELECT * FROM users WHERE id = ? AND user_type = ?', 
            [studentId, 'student']
        );
        
        if (originalData.length === 0) {
            await connection.end();
            return res.status(404).json({
                success: false,
                message: '学生不存在'
            });
        }

        // 检查学号和用户名是否被其他学生使用
        const checkQuery = 'SELECT id FROM users WHERE (student_id = ? OR username = ?) AND id != ?';
        const [existing] = await connection.execute(checkQuery, [student_id, username, studentId]);
        
        if (existing.length > 0) {
            await connection.end();
            return res.status(400).json({
                success: false,
                message: '学号或用户名已被其他学生使用'
            });
        }

        // 更新学生信息
        const updateQuery = `
            UPDATE users SET 
                student_id = ?, username = ?, real_name = ?, grade = ?, 
                major = ?, class_name = ?, email = ?, phone = ?, 
                credit_limit = ?, status = ?
            WHERE id = ? AND user_type = 'student'
        `;
        
        await connection.execute(updateQuery, [
            student_id, username, real_name, grade, major,
            class_name, email, phone, credit_limit, status, studentId
        ]);

        await connection.end();

        // 记录操作日志
        await logAdminOperation(
            req.user.id,
            'update',
            'user_management',
            `更新学生: ${real_name} (${student_id})`,
            { 
                original: originalData[0], 
                updated: req.body 
            },
            'success',
            req
        );

        res.json({
            success: true,
            message: '学生信息更新成功'
        });
    } catch (error) {
        console.error('更新学生失败:', error);
        
        await logAdminOperation(
            req.user.id,
            'update',
            'user_management',
            `更新学生失败: ID ${req.params.id}`,
            req.body,
            'failed',
            req,
            error.message
        );
        
        res.status(500).json({
            success: false,
            message: '更新学生失败'
        });
    }
}

// 更新学生状态
async function updateStudentStatus(req, res) {
    try {
        const studentId = req.params.id;
        const { status } = req.body;

        if (!['active', 'inactive'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: '无效的状态值'
            });
        }

        const connection = await mysql.createConnection(config);

        // 获取学生信息
        const [studentData] = await connection.execute(
            'SELECT real_name, student_id FROM users WHERE id = ? AND user_type = ?', 
            [studentId, 'student']
        );
        
        if (studentData.length === 0) {
            await connection.end();
            return res.status(404).json({
                success: false,
                message: '学生不存在'
            });
        }

        // 更新状态
        await connection.execute(
            'UPDATE users SET status = ? WHERE id = ? AND user_type = ?',
            [status, studentId, 'student']
        );

        await connection.end();

        // 记录操作日志
        await logAdminOperation(
            req.user.id,
            'update',
            'user_management',
            `${status === 'active' ? '启用' : '暂停'}学生: ${studentData[0].real_name} (${studentData[0].student_id})`,
            { student_id: studentId, status },
            'success',
            req
        );

        res.json({
            success: true,
            message: `学生${status === 'active' ? '启用' : '暂停'}成功`
        });
    } catch (error) {
        console.error('更新学生状态失败:', error);
        
        await logAdminOperation(
            req.user.id,
            'update',
            'user_management',
            `更新学生状态失败: ID ${req.params.id}`,
            { status: req.body.status },
            'failed',
            req,
            error.message
        );
        
        res.status(500).json({
            success: false,
            message: '更新学生状态失败'
        });
    }
}

// 获取管理员列表
async function getAdmins(req, res) {
    try {
        const { page = 1, limit = 20 } = req.query;

        const connection = await mysql.createConnection(config);

        // 获取总数
        const [countResult] = await connection.execute(
            'SELECT COUNT(*) as total FROM admin_users'
        );
        const total = countResult[0].total;

        // 获取分页数据
        const offset = (page - 1) * limit;
        const [rows] = await connection.execute(`
            SELECT id, username, real_name, role, email, phone, status, 
                   last_login, created_at
            FROM admin_users 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `, [parseInt(limit), parseInt(offset)]);

        await connection.end();

        // 记录操作日志
        await logAdminOperation(
            req.user.id,
            'read',
            'user_management',
            '获取管理员列表',
            { page, limit },
            'success',
            req
        );

        res.json({
            success: true,
            data: rows,
            total,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error('获取管理员列表失败:', error);
        res.status(500).json({
            success: false,
            message: '获取管理员列表失败'
        });
    }
}

// 创建管理员
async function createAdmin(req, res) {
    try {
        const { username, real_name, role, email, phone, password } = req.body;

        // 验证必填字段
        if (!username || !real_name || !role || !email || !password) {
            return res.status(400).json({
                success: false,
                message: '请填写必填字段'
            });
        }

        // 验证角色
        if (!['super_admin', 'admin', 'operator'].includes(role)) {
            return res.status(400).json({
                success: false,
                message: '无效的角色'
            });
        }

        const connection = await mysql.createConnection(config);

        // 检查用户名是否已存在
        const [existing] = await connection.execute(
            'SELECT id FROM admin_users WHERE username = ?',
            [username]
        );
        
        if (existing.length > 0) {
            await connection.end();
            return res.status(400).json({
                success: false,
                message: '用户名已存在'
            });
        }

        // 加密密码
        const hashedPassword = await bcrypt.hash(password, 10);

        // 创建管理员
        const [result] = await connection.execute(`
            INSERT INTO admin_users (username, password, real_name, role, email, phone, status) 
            VALUES (?, ?, ?, ?, ?, ?, 'active')
        `, [username, hashedPassword, real_name, role, email, phone]);

        await connection.end();

        // 记录操作日志
        await logAdminOperation(
            req.user.id,
            'create',
            'user_management',
            `创建管理员: ${real_name} (${username})`,
            { username, real_name, role, email },
            'success',
            req
        );

        res.json({
            success: true,
            message: '管理员创建成功',
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('创建管理员失败:', error);
        
        await logAdminOperation(
            req.user.id,
            'create',
            'user_management',
            `创建管理员失败: ${req.body.real_name}`,
            req.body,
            'failed',
            req,
            error.message
        );
        
        res.status(500).json({
            success: false,
            message: '创建管理员失败'
        });
    }
}

// 更新管理员
async function updateAdmin(req, res) {
    try {
        const adminId = req.params.id;
        const { real_name, role, email, phone, status } = req.body;

        // 不能修改自己的状态
        if (req.user.id === parseInt(adminId) && status) {
            return res.status(400).json({
                success: false,
                message: '不能修改自己的状态'
            });
        }

        const connection = await mysql.createConnection(config);

        // 获取原始数据
        const [originalData] = await connection.execute(
            'SELECT * FROM admin_users WHERE id = ?', 
            [adminId]
        );
        
        if (originalData.length === 0) {
            await connection.end();
            return res.status(404).json({
                success: false,
                message: '管理员不存在'
            });
        }

        // 更新管理员信息
        await connection.execute(`
            UPDATE admin_users SET 
                real_name = ?, role = ?, email = ?, phone = ?, status = ?
            WHERE id = ?
        `, [real_name, role, email, phone, status, adminId]);

        await connection.end();

        // 记录操作日志
        await logAdminOperation(
            req.user.id,
            'update',
            'user_management',
            `更新管理员: ${real_name} (${originalData[0].username})`,
            { 
                original: originalData[0], 
                updated: req.body 
            },
            'success',
            req
        );

        res.json({
            success: true,
            message: '管理员信息更新成功'
        });
    } catch (error) {
        console.error('更新管理员失败:', error);
        
        await logAdminOperation(
            req.user.id,
            'update',
            'user_management',
            `更新管理员失败: ID ${req.params.id}`,
            req.body,
            'failed',
            req,
            error.message
        );
        
        res.status(500).json({
            success: false,
            message: '更新管理员失败'
        });
    }
}

// 更新管理员状态
async function updateAdminStatus(req, res) {
    try {
        const adminId = req.params.id;
        const { status } = req.body;

        // 不能修改自己的状态
        if (req.user.id === parseInt(adminId)) {
            return res.status(400).json({
                success: false,
                message: '不能修改自己的状态'
            });
        }

        if (!['active', 'inactive'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: '无效的状态值'
            });
        }

        const connection = await mysql.createConnection(config);

        // 获取管理员信息
        const [adminData] = await connection.execute(
            'SELECT real_name, username FROM admin_users WHERE id = ?', 
            [adminId]
        );
        
        if (adminData.length === 0) {
            await connection.end();
            return res.status(404).json({
                success: false,
                message: '管理员不存在'
            });
        }

        // 更新状态
        await connection.execute(
            'UPDATE admin_users SET status = ? WHERE id = ?',
            [status, adminId]
        );

        await connection.end();

        // 记录操作日志
        await logAdminOperation(
            req.user.id,
            'update',
            'user_management',
            `${status === 'active' ? '启用' : '禁用'}管理员: ${adminData[0].real_name} (${adminData[0].username})`,
            { admin_id: adminId, status },
            'success',
            req
        );

        res.json({
            success: true,
            message: `管理员${status === 'active' ? '启用' : '禁用'}成功`
        });
    } catch (error) {
        console.error('更新管理员状态失败:', error);
        
        await logAdminOperation(
            req.user.id,
            'update',
            'user_management',
            `更新管理员状态失败: ID ${req.params.id}`,
            { status: req.body.status },
            'failed',
            req,
            error.message
        );
        
        res.status(500).json({
            success: false,
            message: '更新管理员状态失败'
        });
    }
}

module.exports = {
    getStudents,
    createStudent,
    updateStudent,
    updateStudentStatus,
    getAdmins,
    createAdmin,
    updateAdmin,
    updateAdminStatus
};
