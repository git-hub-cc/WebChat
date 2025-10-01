/**
 * [新文件]
 * Spring Data JPA 仓库接口，用于 `SharedLocation` 实体的数据库操作。
 * 继承 `JpaRepository` 会自动提供标准的CRUD方法。
 */
package club.ppmc.repository;

import club.ppmc.model.SharedLocation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface SharedLocationRepository extends JpaRepository<SharedLocation, Long> {
    // JpaRepository 已经提供了 findAll(), save(), findById(), deleteById() 等方法。
    // 如果未来需要自定义查询（例如，按用户ID查找），可以在这里添加方法。
}