const { query } = require('../config/database');
const moment = require('moment');

// 获取待处理的特殊申请列表
const getPendingApplications = async (req, res) => {
    try {
        const teacherId = req.user?.teacherId;
        const { page = 1, limit = 10, type } = req.query;
        
        // 检查teacherId
        if (!teacherId) {
            return res.status(401).json({
                success: false,
                message: '教师ID未找到'
            });
        }

        // 确保page和limit是有效的数字
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.max(1, Math.min(100, Number(limit) || 10));
        const offsetNum = (pageNum - 1) * limitNum;

        // 构建查询条件
        let whereClause = 'WHERE c.teacher_id = ? AND sa.status = ?';
        let queryParams = [teacherId, 'pending'];

        if (type && type.trim()) {
            whereClause += ' AND sa.request_type = ?';
            queryParams.push(type.trim());
        }

        // 执行查询
        const querySQL = `
            SELECT 
                sa.id,
                sa.status,
                sa.reason,
                sa.request_type,
                sa.created_at,
                u.student_id as student_number,
                u.real_name as student_name,
                c.name as course_name,
                c.course_code
            FROM special_applications sa
            INNER JOIN users u ON sa.student_id = u.id
            INNER JOIN courses c ON sa.course_id = c.id
            ${whereClause}
            ORDER BY sa.created_at ASC
            LIMIT ${limitNum} OFFSET ${offsetNum}
        `;

        const applications = await query(querySQL, queryParams);

        // 获取总数
        const countQuery = `
            SELECT COUNT(*) as total
            FROM special_applications sa
            JOIN courses c ON sa.course_id = c.id
            ${whereClause}
        `;
        // 计数查询使用相同的查询参数（不需要移除任何参数，因为limit/offset是嵌入在SQL中的）
        const countResult = await query(countQuery, queryParams);

        res.json({
            success: true,
            data: {
                applications,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: countResult[0]?.total || 0,
                    pages: Math.ceil((countResult[0]?.total || 0) / limitNum)
                }
            }
        });

    } catch (error) {
        console.error('获取待处理申请列表失败:', error);
        res.status(500).json({
            success: false,
            message: '获取申请列表失败'
        });
    }
};

// 获取所有申请历史（包括已处理的）
const getAllApplications = async (req, res) => {
    try {
        const teacherId = req.user?.teacherId;
        const { page = 1, limit = 10, status, type } = req.query;
        
        if (!teacherId) {
            return res.status(401).json({
                success: false,
                message: '教师ID未找到'
            });
        }

        // 确保page和limit是有效的数字
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.max(1, Math.min(100, Number(limit) || 10));
        const offsetNum = (pageNum - 1) * limitNum;

        let whereClause = 'WHERE c.teacher_id = ?';
        let queryParams = [teacherId];

        if (status && status.trim()) {
            whereClause += ' AND sa.status = ?';
            queryParams.push(status.trim());
        }

        if (type && type.trim()) {
            whereClause += ' AND sa.request_type = ?';
            queryParams.push(type.trim());
        }

        const querySQL = `
            SELECT 
                sa.id,
                sa.status,
                sa.reason,
                sa.request_type,
                sa.created_at,
                sa.processed_at,
                u.student_id as student_number,
                u.real_name as student_name,
                c.name as course_name,
                c.course_code
            FROM special_applications sa
            JOIN users u ON sa.student_id = u.id
            JOIN courses c ON sa.course_id = c.id
            ${whereClause}
            ORDER BY sa.created_at DESC
            LIMIT ${limitNum} OFFSET ${offsetNum}
        `;

        const applications = await query(querySQL, queryParams);

        // 获取总数
        const countQuery = `
            SELECT COUNT(*) as total
            FROM special_applications sa
            JOIN courses c ON sa.course_id = c.id
            ${whereClause}
        `;
        const countResult = await query(countQuery, queryParams);

        res.json({
            success: true,
            data: {
                applications,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: countResult[0]?.total || 0,
                    pages: Math.ceil((countResult[0]?.total || 0) / limitNum)
                }
            }
        });

    } catch (error) {
        console.error('获取申请历史错误:', error);
        res.status(500).json({
            success: false,
            message: '获取申请历史失败'
        });
    }
};

// 获取单个申请详情
const getApplicationDetail = async (req, res) => {
    try {
        const teacherId = req.user?.teacherId;
        const applicationId = parseInt(req.params.id);

        if (!teacherId) {
            return res.status(401).json({
                success: false,
                message: '教师ID未找到'
            });
        }

        if (!applicationId || isNaN(applicationId)) {
            return res.status(400).json({
                success: false,
                message: '申请ID无效'
            });
        }

        const querySQL = `
            SELECT 
                sa.id,
                sa.status,
                sa.reason,
                sa.request_type,
                sa.created_at,
                sa.processed_at,
                sa.teacher_comment,
                u.student_id as student_number,
                u.real_name as student_name,
                c.name as course_name,
                c.course_code
            FROM special_applications sa
            JOIN users u ON sa.student_id = u.id
            JOIN courses c ON sa.course_id = c.id
            WHERE sa.id = ? AND c.teacher_id = ?
        `;

        const applications = await query(querySQL, [applicationId, teacherId]);

        if (!applications.length) {
            return res.status(404).json({
                success: false,
                message: '申请不存在或无权限访问'
            });
        }

        res.json({
            success: true,
            data: applications[0]
        });

    } catch (error) {
        console.error('获取申请详情错误:', error);
        res.status(500).json({
            success: false,
            message: '获取申请详情失败'
        });
    }
};

// 处理申请（批准或拒绝）
const processApplication = async (req, res) => {
    try {
        const teacherId = req.user?.teacherId;
        const applicationId = parseInt(req.params.id);
        const { action, comment = '' } = req.body;

        if (!teacherId) {
            return res.status(401).json({
                success: false,
                message: '教师ID未找到'
            });
        }

        if (!applicationId || isNaN(applicationId)) {
            return res.status(400).json({
                success: false,
                message: '申请ID无效'
            });
        }

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({
                success: false,
                message: '无效的操作类型'
            });
        }

        // 先检查申请是否存在且属于该教师
        const checkSQL = `
            SELECT sa.id, sa.status
            FROM special_applications sa
            JOIN courses c ON sa.course_id = c.id
            WHERE sa.id = ? AND c.teacher_id = ?
        `;
        const existingApplications = await query(checkSQL, [applicationId, teacherId]);

        if (!existingApplications.length) {
            return res.status(404).json({
                success: false,
                message: '申请不存在或无权限访问'
            });
        }

        if (existingApplications[0].status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: '该申请已被处理'
            });
        }

        // 更新申请状态
        const status = action === 'approve' ? 'approved' : 'rejected';
        const updateSQL = `
            UPDATE special_applications 
            SET status = ?, teacher_id = ?, processed_at = NOW(), teacher_comment = ?
            WHERE id = ?
        `;
        
        await query(updateSQL, [status, teacherId, comment, applicationId]);

        res.json({
            success: true,
            message: `申请${action === 'approve' ? '批准' : '拒绝'}成功`
        });

    } catch (error) {
        console.error('处理申请错误:', error);
        res.status(500).json({
            success: false,
            message: '处理申请失败'
        });
    }
};

// 批量处理申请
const batchProcessApplications = async (req, res) => {
    try {
        const teacherId = req.user?.teacherId;
        const { applicationIds, action, comment = '' } = req.body;

        if (!teacherId) {
            return res.status(401).json({
                success: false,
                message: '教师ID未找到'
            });
        }

        if (!Array.isArray(applicationIds) || !applicationIds.length) {
            return res.status(400).json({
                success: false,
                message: '请选择要处理的申请'
            });
        }

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({
                success: false,
                message: '无效的操作类型'
            });
        }

        // 验证所有applicationIds都是有效数字
        const validIds = applicationIds.filter(id => !isNaN(parseInt(id))).map(id => parseInt(id));
        if (!validIds.length) {
            return res.status(400).json({
                success: false,
                message: '无效的申请ID'
            });
        }

        const status = action === 'approve' ? 'approved' : 'rejected';
        const placeholders = validIds.map(() => '?').join(',');

        // 批量更新
        const updateSQL = `
            UPDATE special_applications sa
            JOIN courses c ON sa.course_id = c.id
            SET sa.status = ?, sa.teacher_id = ?, sa.processed_at = NOW(), sa.teacher_comment = ?
            WHERE sa.id IN (${placeholders}) AND c.teacher_id = ? AND sa.status = 'pending'
        `;

        const params = [status, teacherId, comment, ...validIds, teacherId];
        const result = await query(updateSQL, params);

        res.json({
            success: true,
            message: `成功${action === 'approve' ? '批准' : '拒绝'}${result.affectedRows}个申请`,
            data: {
                processedCount: result.affectedRows
            }
        });

    } catch (error) {
        console.error('批量处理申请错误:', error);
        res.status(500).json({
            success: false,
            message: '批量处理申请失败'
        });
    }
};

module.exports = {
    getPendingApplications,
    getAllApplications,
    getApplicationDetail,
    processApplication,
    batchProcessApplications
};