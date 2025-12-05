const { query } = require('../config/database');

// ==================== 教师资质管理 ====================

// 获取教师资质列表
exports.getQualifications = async (req, res) => {
    try {
        const { page = 1, limit = 10, teacher_id, sport_category, qualification_level, status } = req.query;
        const offset = (page - 1) * limit;

        let whereConditions = [];
        let params = [];

        if (teacher_id) {
            whereConditions.push('tq.teacher_id = ?');
            params.push(teacher_id);
        }

        if (sport_category) {
            whereConditions.push('tq.sport_category = ?');
            params.push(sport_category);
        }

        if (qualification_level) {
            whereConditions.push('tq.qualification_level = ?');
            params.push(qualification_level);
        }

        if (status !== undefined) {
            if (status === 'active') {
                whereConditions.push('tq.is_active = 1 AND (tq.expire_date IS NULL OR tq.expire_date > NOW())');
            } else if (status === 'expired') {
                whereConditions.push('tq.expire_date <= NOW()');
            } else if (status === 'inactive') {
                whereConditions.push('tq.is_active = 0');
            }
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // 获取总数
        const countResult = await query(
            `SELECT COUNT(*) as total 
             FROM teacher_qualifications tq 
             ${whereClause}`,
            params
        );

        // 获取资质列表
        const qualifications = await query(
            `SELECT 
                tq.*,
                t.name as teacher_name,
                t.employee_id,
                t.department,
                CASE 
                    WHEN tq.expire_date IS NOT NULL AND tq.expire_date <= NOW() THEN 'expired'
                    WHEN tq.is_active = 0 THEN 'inactive'
                    ELSE 'active'
                END as status
             FROM teacher_qualifications tq
             LEFT JOIN teachers t ON tq.teacher_id = t.id
             ${whereClause}
             ORDER BY tq.created_at DESC
             LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`,
            params
        );

        res.json({
            success: true,
            data: {
                list: qualifications,
                total: countResult[0].total,
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('获取教师资质列表错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取单个教师的所有资质
exports.getTeacherQualifications = async (req, res) => {
    try {
        const { teacherId } = req.params;

        // 获取教师信息
        const teachers = await query(
            'SELECT * FROM teachers WHERE id = ?',
            [teacherId]
        );

        if (teachers.length === 0) {
            return res.status(404).json({
                success: false,
                message: '教师不存在'
            });
        }

        // 获取教师资质
        const qualifications = await query(
            `SELECT 
                tq.*,
                CASE 
                    WHEN tq.expire_date IS NOT NULL AND tq.expire_date <= NOW() THEN 'expired'
                    WHEN tq.is_active = 0 THEN 'inactive'
                    ELSE 'active'
                END as status
             FROM teacher_qualifications tq
             WHERE tq.teacher_id = ?
             ORDER BY tq.qualification_level DESC, tq.issue_date DESC`,
            [teacherId]
        );

        // 统计资质情况
        const statistics = {
            total: qualifications.length,
            active: qualifications.filter(q => q.status === 'active').length,
            expired: qualifications.filter(q => q.status === 'expired').length,
            inactive: qualifications.filter(q => q.status === 'inactive').length,
            byLevel: {
                '国家级': qualifications.filter(q => q.qualification_level === '国家级').length,
                '省级': qualifications.filter(q => q.qualification_level === '省级').length,
                '市级': qualifications.filter(q => q.qualification_level === '市级').length,
                '校级': qualifications.filter(q => q.qualification_level === '校级').length,
                '其他': qualifications.filter(q => q.qualification_level === '其他').length
            }
        };

        res.json({
            success: true,
            data: {
                teacher: teachers[0],
                qualifications,
                statistics
            }
        });

    } catch (error) {
        console.error('获取教师资质错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 创建教师资质
exports.createQualification = async (req, res) => {
    try {
        const {
            teacher_id,
            sport_category,
            qualification_level,
            certificate_name,
            certificate_number,
            issue_date,
            expire_date,
            issuing_authority,
            description,
            attachment_url,
            is_active = true
        } = req.body;

        const adminId = req.user.id;

        // 验证必填字段
        if (!teacher_id || !sport_category || !certificate_name) {
            return res.status(400).json({
                success: false,
                message: '教师ID、体育类别和证书名称为必填项'
            });
        }

        // 检查教师是否存在
        const teachers = await query(
            'SELECT id FROM teachers WHERE id = ?',
            [teacher_id]
        );

        if (teachers.length === 0) {
            return res.status(404).json({
                success: false,
                message: '教师不存在'
            });
        }

        // 检查证书编号是否重复
        if (certificate_number) {
            const existing = await query(
                'SELECT id FROM teacher_qualifications WHERE certificate_number = ?',
                [certificate_number]
            );

            if (existing.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: '证书编号已存在'
                });
            }
        }

        // 创建资质记录
        const result = await query(
            `INSERT INTO teacher_qualifications 
             (teacher_id, sport_category, qualification_level, certificate_name, 
              certificate_number, issue_date, expire_date, issuing_authority, 
              description, attachment_url, is_active, verified_status, verified_by, verified_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, NOW())`,
            [
                teacher_id,
                sport_category,
                qualification_level || '其他',
                certificate_name,
                certificate_number,
                issue_date || null,
                expire_date || null,
                issuing_authority,
                description,
                attachment_url,
                is_active ? 1 : 0,
                adminId
            ]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'create',
                'teacher_qualification',
                `添加教师资质: ${certificate_name}`,
                'qualification',
                result.insertId,
                req.ip || '',
                req.get('User-Agent') || '',
                'SUCCESS'
            ]
        );

        res.json({
            success: true,
            message: '资质添加成功',
            data: { id: result.insertId }
        });

    } catch (error) {
        console.error('创建教师资质错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 更新教师资质
exports.updateQualification = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            sport_category,
            qualification_level,
            certificate_name,
            certificate_number,
            issue_date,
            expire_date,
            issuing_authority,
            description,
            attachment_url,
            is_active
        } = req.body;

        const adminId = req.user.id;

        // 检查资质是否存在
        const existing = await query(
            'SELECT * FROM teacher_qualifications WHERE id = ?',
            [id]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: '资质记录不存在'
            });
        }

        const oldData = existing[0];

        // 检查证书编号是否重复（排除自己）
        if (certificate_number && certificate_number !== oldData.certificate_number) {
            const duplicate = await query(
                'SELECT id FROM teacher_qualifications WHERE certificate_number = ? AND id != ?',
                [certificate_number, id]
            );

            if (duplicate.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: '证书编号已存在'
                });
            }
        }

        // 更新资质
        await query(
            `UPDATE teacher_qualifications 
             SET sport_category = ?,
                 qualification_level = ?,
                 certificate_name = ?,
                 certificate_number = ?,
                 issue_date = ?,
                 expire_date = ?,
                 issuing_authority = ?,
                 description = ?,
                 attachment_url = ?,
                 is_active = ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [
                sport_category,
                qualification_level,
                certificate_name,
                certificate_number,
                issue_date || null,
                expire_date || null,
                issuing_authority,
                description,
                attachment_url,
                is_active ? 1 : 0,
                id
            ]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, old_data, new_data, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'update',
                'teacher_qualification',
                `更新教师资质: ${certificate_name}`,
                'qualification',
                id,
                JSON.stringify(oldData),
                JSON.stringify(req.body),
                req.ip || '',
                req.get('User-Agent') || '',
                'SUCCESS'
            ]
        );

        res.json({
            success: true,
            message: '资质更新成功'
        });

    } catch (error) {
        console.error('更新教师资质错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 删除教师资质
exports.deleteQualification = async (req, res) => {
    try {
        const { id } = req.params;
        const adminId = req.user.id;

        // 检查资质是否存在
        const existing = await query(
            'SELECT * FROM teacher_qualifications WHERE id = ?',
            [id]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: '资质记录不存在'
            });
        }

        // 删除资质
        await query(
            'DELETE FROM teacher_qualifications WHERE id = ?',
            [id]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, old_data, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'delete',
                'teacher_qualification',
                `删除教师资质: ${existing[0].certificate_name}`,
                'qualification',
                id,
                JSON.stringify(existing[0]),
                req.ip || '',
                req.get('User-Agent') || '',
                'SUCCESS'
            ]
        );

        res.json({
            success: true,
            message: '资质删除成功'
        });

    } catch (error) {
        console.error('删除教师资质错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 批量更新资质状态
exports.updateQualificationStatus = async (req, res) => {
    try {
        const { ids, is_active } = req.body;
        const adminId = req.user.id;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: '请选择要更新的资质'
            });
        }

        // 更新状态
        const placeholders = ids.map(() => '?').join(',');
        await query(
            `UPDATE teacher_qualifications 
             SET is_active = ?, updated_at = NOW()
             WHERE id IN (${placeholders})`,
            [is_active ? 1 : 0, ...ids]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'batch_update',
                'teacher_qualification',
                `批量${is_active ? '启用' : '禁用'}教师资质: ${ids.join(', ')}`,
                'qualification',
                0,
                req.ip || '',
                req.get('User-Agent') || '',
                'SUCCESS'
            ]
        );

        res.json({
            success: true,
            message: `成功${is_active ? '启用' : '禁用'}${ids.length}个资质`
        });

    } catch (error) {
        console.error('批量更新资质状态错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 获取资质统计信息
exports.getQualificationStatistics = async (req, res) => {
    try {
        // 总体统计
        const totalStats = await query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN is_active = 1 AND (expire_date IS NULL OR expire_date > NOW()) THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN expire_date IS NOT NULL AND expire_date <= NOW() THEN 1 ELSE 0 END) as expired,
                SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive
            FROM teacher_qualifications
        `);

        // 按级别统计
        const levelStats = await query(`
            SELECT 
                qualification_level,
                COUNT(*) as count
            FROM teacher_qualifications
            WHERE is_active = 1
            GROUP BY qualification_level
            ORDER BY FIELD(qualification_level, '国家级', '省级', '市级', '校级', '其他')
        `);

        // 按体育类别统计
        const categoryStats = await query(`
            SELECT 
                sport_category,
                COUNT(*) as count
            FROM teacher_qualifications
            WHERE is_active = 1
            GROUP BY sport_category
            ORDER BY count DESC
        `);

        // 即将过期的资质（30天内）
        const expiringSoon = await query(`
            SELECT 
                tq.*,
                t.name as teacher_name,
                t.employee_id
            FROM teacher_qualifications tq
            LEFT JOIN teachers t ON tq.teacher_id = t.id
            WHERE tq.expire_date IS NOT NULL 
              AND tq.expire_date > NOW() 
              AND tq.expire_date <= DATE_ADD(NOW(), INTERVAL 30 DAY)
              AND tq.is_active = 1
            ORDER BY tq.expire_date ASC
            LIMIT 10
        `);

        // 教师资质覆盖率
        const coverageStats = await query(`
            SELECT 
                COUNT(DISTINCT t.id) as total_teachers,
                COUNT(DISTINCT tq.teacher_id) as teachers_with_qualification
            FROM teachers t
            LEFT JOIN teacher_qualifications tq ON t.id = tq.teacher_id AND tq.is_active = 1
            WHERE t.status = 'active'
        `);

        const coverage = coverageStats[0].total_teachers > 0 
            ? (coverageStats[0].teachers_with_qualification / coverageStats[0].total_teachers * 100).toFixed(2)
            : 0;

        res.json({
            success: true,
            data: {
                total: totalStats[0],
                byLevel: levelStats,
                byCategory: categoryStats,
                expiringSoon,
                coverage: {
                    ...coverageStats[0],
                    percentage: parseFloat(coverage)
                }
            }
        });

    } catch (error) {
        console.error('获取资质统计错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 验证教师资质
exports.verifyQualification = async (req, res) => {
    try {
        const { id } = req.params;
        const { verified_status, verification_notes } = req.body;
        const adminId = req.user.id;

        if (!['pending', 'verified', 'rejected'].includes(verified_status)) {
            return res.status(400).json({
                success: false,
                message: '无效的验证状态'
            });
        }

        // 检查资质是否存在
        const existing = await query(
            'SELECT * FROM teacher_qualifications WHERE id = ?',
            [id]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: '资质记录不存在'
            });
        }

        // 更新验证状态
        await query(
            `UPDATE teacher_qualifications 
             SET verified_status = ?,
                 verification_notes = ?,
                 verified_by = ?,
                 verified_at = NOW(),
                 updated_at = NOW()
             WHERE id = ?`,
            [verified_status, verification_notes, adminId, id]
        );

        // 记录操作日志
        await query(
            `INSERT INTO admin_operation_logs 
             (admin_id, operation_type, operation_module, operation_description, target_type, target_id, ip_address, user_agent, result) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                adminId,
                'verify',
                'teacher_qualification',
                `验证教师资质: ${existing[0].certificate_name} - ${verified_status}`,
                'qualification',
                id,
                req.ip || '',
                req.get('User-Agent') || '',
                'SUCCESS'
            ]
        );

        res.json({
            success: true,
            message: '资质验证状态更新成功'
        });

    } catch (error) {
        console.error('验证教师资质错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 教师端：获取自己的资质列表
exports.getMyQualifications = async (req, res) => {
    try {
        const teacherId = req.user.teacher_id;

        if (!teacherId) {
            return res.status(400).json({
                success: false,
                message: '未找到关联的教师信息'
            });
        }

        // 获取资质列表
        const qualifications = await query(
            `SELECT 
                tq.*,
                CASE 
                    WHEN tq.expire_date IS NOT NULL AND tq.expire_date <= NOW() THEN 'expired'
                    WHEN tq.is_active = 0 THEN 'inactive'
                    WHEN tq.verified_status = 'pending' THEN 'pending_verification'
                    WHEN tq.verified_status = 'rejected' THEN 'rejected'
                    ELSE 'active'
                END as status
             FROM teacher_qualifications tq
             WHERE tq.teacher_id = ?
             ORDER BY tq.created_at DESC`,
            [teacherId]
        );

        res.json({
            success: true,
            data: qualifications
        });

    } catch (error) {
        console.error('获取教师个人资质错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

// 教师端：申请新资质
exports.applyQualification = async (req, res) => {
    try {
        const teacherId = req.user.teacher_id;
        const {
            sport_category,
            qualification_level,
            certificate_name,
            certificate_number,
            issue_date,
            expire_date,
            issuing_authority,
            description,
            attachment_url
        } = req.body;

        if (!teacherId) {
            return res.status(400).json({
                success: false,
                message: '未找到关联的教师信息'
            });
        }

        // 验证必填字段
        if (!sport_category || !certificate_name) {
            return res.status(400).json({
                success: false,
                message: '体育类别和证书名称为必填项'
            });
        }

        // 检查证书编号是否重复
        if (certificate_number) {
            const existing = await query(
                'SELECT id FROM teacher_qualifications WHERE certificate_number = ?',
                [certificate_number]
            );

            if (existing.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: '证书编号已存在'
                });
            }
        }

        // 创建资质申请（待审核状态）
        const result = await query(
            `INSERT INTO teacher_qualifications 
             (teacher_id, sport_category, qualification_level, certificate_name, 
              certificate_number, issue_date, expire_date, issuing_authority, 
              description, attachment_url, is_active, verified_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending')`,
            [
                teacherId,
                sport_category,
                qualification_level || '其他',
                certificate_name,
                certificate_number,
                issue_date || null,
                expire_date || null,
                issuing_authority,
                description,
                attachment_url
            ]
        );

        res.json({
            success: true,
            message: '资质申请已提交，等待管理员审核',
            data: { id: result.insertId }
        });

    } catch (error) {
        console.error('申请教师资质错误:', error);
        res.status(500).json({
            success: false,
            message: '服务器内部错误'
        });
    }
};

module.exports = exports;
